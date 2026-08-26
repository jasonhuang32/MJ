import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const extension = path.join(root, "extension");
const manifest = JSON.parse(fs.readFileSync(path.join(extension, "manifest.json"), "utf8"));
const errors = [];

const required = [
  "manifest.json",
  "background.js",
  "content.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "lib/detector.js",
  "assets/head.m4a",
  "assets/body.m4a",
  "assets-v2/head-character.png",
  "assets-v2/body-character.png",
  "assets-v2/heart.svg",
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
];

for (const relative of required) {
  const file = path.join(extension, relative);
  if (!fs.existsSync(file)) errors.push(`缺少文件: ${relative}`);
  else if (fs.statSync(file).size === 0) errors.push(`空文件: ${relative}`);
}

if (manifest.manifest_version !== 3) errors.push("manifest_version 必须为 3");
if (!manifest.permissions?.includes("storage")) errors.push("缺少 storage 权限");
if (!manifest.content_scripts?.[0]?.all_frames) errors.push("内容脚本必须支持 iframe");

for (const script of ["background.js", "content.js", "popup.js", "lib/detector.js"]) {
  const source = fs.readFileSync(path.join(extension, script), "utf8");
  try {
    new Function(source);
  } catch (error) {
    errors.push(`${script} 语法错误: ${error.message}`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`扩展结构验证通过（${required.length} 个必要文件）`);
