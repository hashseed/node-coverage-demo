'use strict';
const assert = require('assert');
const inspector = require('inspector');
const http = require('http');
const query = require('querystring');

inspector.Session.prototype.postAsync = function(...args) {
  let resolver;
  let rejecter;
  let p = new Promise(
      function(res, rej) {
        resolver = res;
        rejecter = rej;
      });
  this.post(...args,
      function(error, result) {
        if (error !== null) {
          rejecter(error);
        } else if (result.exceptionDetails !== undefined) {
          console.log(result);
          rejecter(result.exceptionDetails.exception.description);
        } else {
          resolver(result);
        }
      });
  return p;
};

const example_script =
`
function fib(x) {
  if (x < 2) {
    return 1;
  }
  return fib(x-1) + fib(x-2);
}

var failed = false;
try {
  fib(8);
} catch (e) {
  failed = true;
}

if (failed) {
  console.log("fail");
} else {
  console.log("success");
}

for (let i = 0; i < 10; i++) {
  console.log(i);
}
`;

const template =
`
<html>
<body>
<style>
#left, #right { display: table-cell }
#left { float: left, width: 500px }
#right { width: 500px }
</style>
<tt>
<div>
<div id="left">
<h1>script</h1>
<form method="post">
  <textarea name="script" rows="24" cols="40">SCRIPT</textarea>
  <br/>
  <input type="submit" value="obtain coverage">
</form>
</div>
<div id="right">
<h1>coverage</h1>
RESULT
</div>
</div>
<h1>console</h1>
CONSOLE
</tt>
</body>
</html>
`;

async function CollectCoverage(source) {
  const session = new inspector.Session();
  session.connect();
  await session.postAsync('Runtime.enable');
  await session.postAsync('Profiler.enable');
  await session.postAsync('Profiler.startPreciseCoverage',
                          { callCount: true });
  let { scriptId } =
      await session.postAsync('Runtime.compileScript',
                              { expression: source,
                                sourceURL: "test",
                                persistScript: true });
  let messages = [];
  session.on('Runtime.consoleAPICalled', message => messages.push(message));
  await session.postAsync('Runtime.runScript',
                          { scriptId });
  await session.postAsync('HeapProfiler.collectGarbage');
  let { result } =
      await session.postAsync('Profiler.takePreciseCoverage');
  let coverage = result.filter(x => x.scriptId == scriptId)[0];
  session.disconnect();
  return [coverage.functions, messages];
}

function Escape(string) {
  return string.replace(/ /g, "&nbsp;").replace(/\r\n/g, "<br/>")
}

function MarkUpCode(coverage, source) {
  let ranges = coverage.reduce(
      (result, next) => result = result.concat(next.ranges), []);
  ranges.sort((a, b) => a.startOffset == b.startOffset
                            ? b.endOffset - a.endOffset
                            : a.startOffset - b.startOffset);
  let stack = [];
  stack.top = function() {
    if (this.length == 0) return undefined;
    return this[this.length - 1];
  }
  let result = "";
  let cursor = 0;
  function CloseSpan() {
    result += Escape(source.substring(cursor, stack.top().endOffset));
    cursor = stack.top().endOffset;
    result += `</span>`;
    stack.pop();
  }
  function Color(count) {
    let c = count * 2 | 0;
    if (c > 0) c += 32;
    return `rgb(255, ${255-c}, ${255-c})`;
  }
  for (let range of ranges) {
    while (stack.top() !== undefined) {
      if (range.startOffset < stack.top().endOffset) break;
      CloseSpan();
    }
    result += Escape(source.substring(cursor, range.startOffset));
    result += `<span ${range.count}>`;
    cursor = range.startOffset;
    stack.push(range);
  }
  while (stack.top() !== undefined) CloseSpan();
  result = result.replace(/<span 0>(((?:&nbsp;)|(?:<br\/>))*}((?:&nbsp;)|(?:<br\/>))*)<\/span>/g, "$1");
  result = result.replace(/<span (\d+)>/g,
      function(match, group) {
        let count = parseInt(group);
        return `<span style="background-color: ${Color(count)}", title="count: ${count}">`;
      });
  return result;
}

async function GetPostBody(req) {
  let body = "";
  let body_completed;
  let post_promise = new Promise(res => body_completed = res);
  req.on('data', data => body += data);
  req.on('end', () => body_completed(query.parse(body)));
  return post_promise;
}

async function Respond(req, res) {
  let script = example_script;
  let result = "";
  let message_log = "";
  if (req.method == 'POST') {
    try {
      let body = await GetPostBody(req);
      script = body.script;
      let [coverage, messages] = await CollectCoverage(script);
      result = MarkUpCode(coverage, script);
      for (let message of messages) {
        message_log += `<br/>console.${message.params.type}: ${message.params.args[0].value}`;
      }
    } catch (e) {
      console.error(e);
      result = Escape(e.toString());
    }
  }
  res.end(template.replace("SCRIPT", script)
                  .replace("RESULT", result)
                  .replace("CONSOLE", message_log));
  return;
}

http.createServer(function(req, res) {
  res.writeHead(200, {'Content-Type': 'text/html'});
  Respond(req, res);
}).listen(8080);
