function add(left,
             right) {
  return left + right;
}

class Potato {
  valueOf() { return 3; }
}
class Tomato {
  toString() { return "T"; }
}

console.log(add(1, 2));
console.log(add(1, "2"));
console.log(add(new Potato, new Tomato));
