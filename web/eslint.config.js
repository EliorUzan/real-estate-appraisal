import js from "@eslint/js";
import tseslint from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";
import refresh from "eslint-plugin-react-refresh";
export default tseslint.config(
 {ignores:["dist/**","node_modules/**",".npm-cache/**"]},
 js.configs.recommended,
 ...tseslint.configs.recommended,
 {
  files:["**/*.{ts,tsx}"],
  languageOptions:{globals:Object.fromEntries(["window","document","navigator","crypto","location","history","Blob","URL","File","fetch","setTimeout","clearTimeout","process","console"].map(name=>[name,"readonly"]))},
  plugins:{"react-hooks":hooks,"react-refresh":refresh},
  rules:{...hooks.configs.recommended.rules,"react-refresh/only-export-components":["warn",{allowConstantExport:true}]},
 }
);

