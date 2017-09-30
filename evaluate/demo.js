'use strict';

const http = require('http');
const inspector = require('inspector');
const { ReadFile, GetPostBody, Escape } = require('shared');

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

