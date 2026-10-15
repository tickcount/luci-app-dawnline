// Stylesheets are imported as text (tsup: loader '.css' → 'text').
declare module '*.css' {
  const css: string;
  export default css;
}
