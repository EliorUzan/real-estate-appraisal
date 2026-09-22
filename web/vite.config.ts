import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// Development-only bridge. No credentials are exposed to browser JavaScript.
export default defineConfig({
  plugins: [react(), {
    name:"local-desktop-credential-import",
    apply:"serve",
    configureServer(server) {
      server.middlewares.use("/__desktop/import", (req,res) => {
        res.setHeader("Content-Type","application/json");
        res.setHeader("Cache-Control","no-store");
        if(req.method!=="POST" || req.headers.origin!=="http://127.0.0.1:5175" || req.headers.host!=="127.0.0.1:5175") {
          res.statusCode=403;res.end(JSON.stringify({error:"Local app access required"}));return;
        }
        let body="";
        req.on("data",chunk=>{body+=chunk;if(body.length>12000)req.destroy();});
        req.on("end",()=>{
          try {
            const data=JSON.parse(body);
            if(typeof data.token!=="string" || data.token.length>10000)throw new Error("Invalid token");
            const root=fileURLToPath(new URL("..",import.meta.url));
            const python=process.env.DESKTOP_PYTHON || resolve(root,".venv/Scripts/python.exe");
            const child=spawn(python,[resolve(root,"tools/import_desktop_keys.py")],{windowsHide:true,stdio:["pipe","pipe","pipe"]});
            let output="";child.stdout.on("data",chunk=>{output+=chunk;});
            // Suppress child stderr because dependency errors could include request details.
            child.stderr.resume();
            const timer=setTimeout(()=>child.kill(),150000);
            child.on("error",()=>{clearTimeout(timer);res.statusCode=500;res.end(JSON.stringify({error:"Desktop Python is unavailable"}));});
            child.on("close",code=>{clearTimeout(timer);if(res.writableEnded)return;res.statusCode=code===0?200:500;res.end(output||JSON.stringify({error:"Desktop import failed"}));});
            child.stdin.end(JSON.stringify({token:data.token}));
          }catch{res.statusCode=400;res.end(JSON.stringify({error:"Invalid request"}));}
        });
      });
    },
  }],
  server: { port:5175,strictPort:true },
});
