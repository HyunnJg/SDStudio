// Resolve the compiler from this small package, never the full app installation.
require('ts-node').register({
  transpileOnly: true,
  skipProject: true,
  compiler: require.resolve('typescript'),
  compilerOptions: {
    target: 'ES2022',
    module: 'CommonJS',
    moduleResolution: 'Node',
    esModuleInterop: true,
    resolveJsonModule: true,
  },
});
