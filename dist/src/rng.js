"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SeededRng = void 0;
class SeededRng {
    state;
    constructor(seed) {
        this.state = seed >>> 0;
    }
    next() {
        this.state = (this.state + 0x6d2b79f5) >>> 0;
        let value = this.state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    }
    range(min, max) {
        return min + (max - min) * this.next();
    }
    integer(minInclusive, maxInclusive) {
        return Math.floor(this.range(minInclusive, maxInclusive + 1));
    }
    shuffle(items) {
        const shuffled = [...items];
        for (let index = shuffled.length - 1; index > 0; index -= 1) {
            const swapIndex = this.integer(0, index);
            [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
        }
        return shuffled;
    }
}
exports.SeededRng = SeededRng;
