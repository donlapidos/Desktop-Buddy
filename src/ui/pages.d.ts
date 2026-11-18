// What preload.cjs gives Buddy's pages: window.buddy, a set of functions that each send one message to main.js, which
// checks what it is given and which window it came from. Typed loosely for now: every member is a function.
interface Window {
  buddy: Record<string, (...args: any[]) => any>;
}

// From ui/strings.js, loaded before each page's own script.
declare function t(text: string, vars?: Record<string, string | number>): string;
declare function N(text: string): string;
declare function applyStrings(root?: ParentNode): void;
declare function whenStrings(fn: () => void): void;
