'use strict';
const inspector = require('inspector');
const http = require('http');
const query = require('querystring');
const fs = require('fs');

inspector.Session.prototype.postAsync = function(...args) {
  let session = this;
  return new Promise(
    function(resolve, reject) {
      session.post(...args,
        function(error, result) {
          if (error !== null) {
            reject(error);
          } else if (result.exceptionDetails !== undefined) {
            reject(result.exceptionDetails.exception.description);
          } else {
            resolve(result);
          }
        });
    });
};

async function ReadFile(file_name) {
  return new Promise(
    function(resolve, reject) {
      fs.readFile(file_name, "utf8", function(error, result) {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      });
    });
}

// Reformat string for HTML.
function Escape(string) {
  return [
    ["&", "&amp;"],
    [" ", "&nbsp;"],
    ["<", "&lt;"],
    [">", "&gt;"],
    ["\r\n", "<br/>"],
    ["\n", "<br/>"],
    ["\"", "&quot;"],
  ].reduce(
    function(string, [pattern, replacement]) {
      return string.replace(new RegExp(pattern, "g"), replacement);
    }, string);
}

async function CollectCoverage(source, callCount, detailed) {
  // Open a new inspector session.
  const session = new inspector.Session();
  let messages = [];
  let coverage = undefined;
  try {
    session.connect();
    // Enable relevant inspector domains.
    await session.postAsync('Runtime.enable');
    await session.postAsync('Profiler.enable');
    await session.postAsync('Profiler.startPreciseCoverage', {
      callCount,
      detailed
    });
    // Compile script.
    let { scriptId } = await session.postAsync('Runtime.compileScript', {
      expression: source,
      sourceURL: "test",
      persistScript: true
    });
    // Collect console log during execution.

    session.on('Runtime.consoleAPICalled',
      message => messages.push(message));
    // Execute script.
    await session.postAsync('Runtime.runScript', { scriptId });
    await session.postAsync('HeapProfiler.collectGarbage');
    // Collect and filter coverage result.
    let { result } = await session.postAsync('Profiler.takePreciseCoverage');
    [{ functions: coverage }] = result.filter(x => x.scriptId == scriptId);
  } finally {
    // Close session and return.
    session.disconnect();
  }
  return [coverage, messages];
}

function MarkUpCode(coverage, source, callCount) {
  let ranges = coverage.reduce(
    (result, next) => result = result.concat(next.ranges), []);
  ranges.sort(function({ startOffset: as, endOffset: ae },
                       { startOffset: bs, endOffset: be }) {
    return as == bs ? be - ae : as - bs;
  });
  let result = "";
  let cursor = 0;
  let stack = [];
  stack.top = function() {
    return this.length ? this[this.length - 1] : undefined;
  }

  // Helper functions.
  function CopySourceUpTo(up_to) {
    result += Escape(source.substring(cursor, up_to));
    cursor = up_to;
  }

  function OpenSpan(range) {
    let count = range.count;
    let c = count > 0 ? count * 2 + 32 | 0 : 0
    result += `<span style="background-color: rgb(255, ${255-c}, ${255-c})"`;
    if (callCount) result += ` title="count: ${count}"`;
    result += ">";
    stack.push(range);
  }

  function CloseSpan() {
    CopySourceUpTo(stack.top().endOffset);
    result += `</span>`;
    stack.pop();
  }

  // Iterate ranges and reconstruct nesting.
  for (let range of ranges) {
    while (stack.top() !== undefined) {
      if (range.startOffset < stack.top().endOffset) break;
      CloseSpan();
    }
    CopySourceUpTo(range.startOffset);
    OpenSpan(range);
  }
  while (stack.top() !== undefined) CloseSpan();
  return result;
}

async function GetPostBody(request) {
  return new Promise(function(resolve) {
    let body = "";
    request.on('data', data => body += data);
    request.on('end', end => resolve(query.parse(body)));
  });
}

async function Server(request, response) {
  let script = "";
  let result = "";
  let message_log = "";
  let detailed = false;
  let count = false;
  if (request.method == 'POST') {
    // Collect coverage on the script from input form.
    try {
      let post = await GetPostBody(request);
      script = post.script;
      count = post.count === "yes";
      detailed = post.detailed === "yes";
      let [coverage, messages] = await CollectCoverage(script, count, detailed);
      result = MarkUpCode(coverage, script, count);
      for (let message of messages) {
        message_log += `console.${message.params.type}: `;
        message_log += `${message.params.args[0].value}<br/>`;
      }
    } catch (e) {
      message_log = Escape(e.toString());
    }
  } else {
    // Use example file.
    script = await ReadFile("coverage/example.js");
  }
  let template = await ReadFile("coverage/template.html");
  let html = [
    ["SCRIPT", script],
    ["RESULT", result],
    ["CONSOLE", message_log],
    ["COUNT_CHECKED", count ? "checked" : ""],
    ["DETAILED_CHECKED", detailed ? "checked" : ""],
  ].reduce(function(template, [pattern, replacement]) {
    return template.replace(pattern, replacement);
  }, template);
  response.writeHead(200, {
    'Content-Type': 'text/html'
  });
  response.end(html);
}

http.createServer(Server).listen(8080);

