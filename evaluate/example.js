function f(x) {
  return function g() {
    debugger;
    console.log(x);
    return x;
  }
}

f(2)();
