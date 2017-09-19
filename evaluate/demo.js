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

async function Evaluate(source, expression, allow_side_effect) {
  // Open a new inspector session.
  const session = new inspector.Session();
  let result = undefined;
  let messages = [];
  try {
    session.connect();
    // Enable relevant inspector domains.
    await session.postAsync('Runtime.enable');
    await session.postAsync('Debugger.enable');
    // Compile script.
    let { scriptId } = await session.postAsync('Runtime.compileScript', {
      expression: source,
      sourceURL: "test",
      persistScript: true
    });

    session.once('Debugger.paused', function(r) {
      let callFrameId = r.params.callFrames[0].callFrameId;
      function after_eval(e, r) {
        if (r.exceptionDetails !== undefined) {
          result = "[exception]";
        } else {
          result = r.result.value;
        }
      }
      session.post('Debugger.evaluateOnCallFrame',
                   { callFrameId,
                     expression,
                     throwOnSideEffect: !allow_side_effect},
                   after_eval);
    });
    session.on('Runtime.consoleAPICalled',
      message => messages.push(message));

    await session.postAsync('Runtime.runScript', { scriptId });
    await session.postAsync('Debugger.disable');
    await session.postAsync('Runtime.disable');
  } finally {
    // Close session and return.
    session.disconnect();
  }
  return [messages, result];
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
  let eval_script = "";
  let message_log = "";
  let allow_side_effect = true;
  if (request.method == 'POST') {
    // Collect coverage on the script from input form.
    try {
      let post = await GetPostBody(request);
      script = post.script;
      eval_script = post.eval;
      allow_side_effect = post.allow == "yes";
      let messages = undefined;
      [messages, result] = await Evaluate(script, eval_script, allow_side_effect);
      for (let message of messages) {
        message_log += `console.${message.params.type}: `;
        message_log += `${message.params.args[0].value}<br/>`;
      }
    } catch (e) {
      console.error("error");
      console.error(e);
    }
  } else {
    // Use example file.
    script = await ReadFile("evaluate/example.js");
    eval_script = await ReadFile("evaluate/eval.js");
  }
  let template = await ReadFile("evaluate/template.html");
  let html = [
    ["SCRIPT", script],
    ["RESULT", result],
    ["EVAL", eval_script],
    ["CONSOLE", message_log],
    ["ALLOW", allow_side_effect ? "checked" : ""],
  ].reduce(function(template, [pattern, replacement]) {
    return template.replace(pattern, replacement);
  }, template);
  response.writeHead(200, {
    'Content-Type': 'text/html'
  });
  response.end(html);
}

// fuser -k 8080/tcp
http.createServer(Server).listen(8080);

