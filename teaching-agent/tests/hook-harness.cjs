const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const ts = require('typescript');

/** 用同一份生产源码测试 Hook 的请求竞争，不依赖 DOM 或新增测试依赖。 */
exports.loadHook = function loadHook(relative, stubs, cache = new Map()) {
  const filename = path.resolve(relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const mod = { exports: {} }; cache.set(filename, mod);
  const native = createRequire(filename);
  const localRequire = id => {
    if (Object.hasOwn(stubs, id)) return stubs[id];
    if (id.startsWith('@/') || id.startsWith('.')) {
      const base = id.startsWith('@/') ? path.resolve('src', id.slice(2)) : path.resolve(path.dirname(filename), id);
      const target = [base, base+'.ts', base+'.tsx'].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
      if (target && /\.tsx?$/.test(target)) return exports.loadHook(target, stubs, cache);
      if (target?.endsWith('.json')) return native(target);
    }
    return native(id);
  };
  const code = ts.transpileModule(fs.readFileSync(filename,'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  }}).outputText;
  new Function('require','module','exports',code)(localRequire,mod,mod.exports);
  return mod.exports;
};

exports.hooks = function hooks() {
  const state = [], refs = []; let si=0, ri=0;
  const react = {
    useState(initial) { const i=si++; if (!(i in state)) state[i]=initial; return [state[i], value=>{ state[i]=typeof value==='function'?value(state[i]):value; }]; },
    useRef(initial) { return refs[ri++] ??= { current: initial }; },
    useCallback(fn) { return fn; }, useEffect() {},
  };
  return { react, render(fn) { si=0; ri=0; return fn(); } };
};
