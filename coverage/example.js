function fib(x) {
  if (x < 2) {
    return 1;
  }
  return fib(x-1) + fib(x-2);
}

function dead() {
  unreachable;
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
