/**
 * ============================================================
 *  server.js —— DeepSeek 对话代理后端
 * ============================================================
 *  作用：
 *    1. 启动一个本地网页服务器（端口 3001），把 index.html 提供给浏览器
 *    2. 接收浏览器发来的用户输入，转发给 DeepSeek 官方 API
 *    3. 把每一轮"用户输入 + AI 回复"追加记录到 chat_log.json
 *
 *  运行方式：  node server.js   （无需安装任何依赖，用的是 Node 自带模块）
 *  访问地址：  http://localhost:3001
 * ============================================================
 */

// 引入 Node.js 自带的三个核心模块（无需 npm install）：
const http = require("http");   // 创建本地 HTTP 服务器（监听浏览器请求）
const fs = require("fs");       // 读写文件（读 index.html、写 chat_log.json）
const path = require("path");   // 拼接文件路径（跨平台兼容 Windows / Mac）

// ------------------ 配置区 ------------------
const API_KEY = "sk-beb28a11bc0843a6a1b322dbf55a247b"; // DeepSeek API 密钥，去 https://platform.deepseek.com 申请
const PORT = 3001;                                      // 监听端口（浏览器访问 http://localhost:3001）
const LOG_FILE = path.join(__dirname, "chat_log.json"); // 对话记录文件路径（__dirname = 本文件所在目录）

/**
 * 往 chat_log.json 追加一条对话记录。
 * 每条记录格式：{ time: "对话时间", user: "用户输入", assistant: "AI 回复" }
 * @param {object} record - 要追加的一条记录
 */
function appendLog(record) {
  let logs = [];
  try {
    // 先读取现有文件内容并解析成数组
    logs = JSON.parse(fs.readFileSync(LOG_FILE, "utf-8"));
  } catch (e) {
    logs = []; // 文件不存在或内容损坏时，从空数组开始
  }
  logs.push(record);                                  // 在数组末尾追加新记录
  fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2), "utf-8"); // 写回文件（缩进 2 空格方便阅读）
}

/**
 * 调用 DeepSeek 官方 API，获取 AI 回复。
 * @param {Array} messages - 完整对话历史数组，
 *        每项形如 { role: "user"|"assistant", content: "文本" }
 * @returns {Promise<string>} AI 的回复文本
 */
function requestDeepSeek(messages) {
  return new Promise((resolve, reject) => {
    // 按 DeepSeek（OpenAI 兼容）格式构造请求体
    const body = JSON.stringify({
      model: "deepseek-chat", // 使用的模型（deepseek-chat = V3 对话模型）
      messages: messages      // 完整对话历史，AI 会结合上下文回复
    });

    // 发起 HTTPS 请求，回调里处理 DeepSeek 返回的数据
    const req = httpsRequest(body, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk)); // 分段接收返回数据并拼接
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.choices && json.choices[0]) {
            // 正常情况：回复文本在 choices[0].message.content 里
            resolve(json.choices[0].message.content);
          } else {
            // DeepSeek 返回了错误（比如 Key 无效、余额不足）
            reject(new Error(json.error ? json.error.message : data));
          }
        } catch (e) {
          reject(new Error("DeepSeek 返回解析失败: " + data));
        }
      });
    });
    req.on("error", reject); // 网络错误（断网、域名不通等）
    req.write(body);         // 写入请求体
    req.end();               // 结束请求，正式发送
  });
}

/**
 * 构造一个发往 DeepSeek 服务器的 HTTPS 请求对象。
 * @param {string} body - 要发送的 JSON 字符串
 * @param {Function} callback - 收到响应时的回调函数
 * @returns {object} 请求对象（调用方继续 req.write / req.end）
 */
function httpsRequest(body, callback) {
  const req = require("https").request(
    {
      hostname: "api.deepseek.com",   // DeepSeek API 域名
      path: "/chat/completions",      // 对话补全接口路径
      method: "POST",                 // 必须用 POST
      headers: {
        "Content-Type": "application/json",        // 告诉服务器发的是 JSON
        "Authorization": "Bearer " + API_KEY,      // 身份验证：Bearer + 密钥
        "Content-Length": Buffer.byteLength(body)  // 请求体长度（字节数）
      }
    },
    callback
  );
  return req;
}

// ------------------ 创建本地服务器 ------------------
// 每当浏览器发来一个请求，这个回调函数就会被执行一次
const server = http.createServer(async (req, res) => {

  // 情况 1：浏览器访问首页（GET http://localhost:3001/）
  // 直接返回 index.html，这就是用户看到的对话页面
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    const html = fs.readFileSync(path.join(__dirname, "index.html")); // 每次请求都重新读文件，改了 HTML 刷新即生效
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); // 200 = 成功，声明编码防止中文乱码
    res.end(html); // 把 HTML 内容发给浏览器
    return;        // 本次请求处理完毕
  }

  // 情况 2：前端发来的对话请求（POST http://localhost:3001/chat）
  if (req.method === "POST" && req.url === "/chat") {
    let body = "";
    req.on("data", (chunk) => (body += chunk)); // 分段接收前端发来的 JSON 数据
    req.on("end", async () => {                 // 数据接收完毕后处理
      try {
        // 前端发来的格式：{ message: "用户输入", history: [之前的对话] }
        const { message, history } = JSON.parse(body);
        // 组装完整对话历史 = 之前的对话 + 本次的用户输入
        const messages = [...(history || []), { role: "user", content: message }];
        // 调用 DeepSeek 拿到回复（await = 等待网络请求完成）
        const reply = await requestDeepSeek(messages);
        // 把本轮"输入 + 输出"连同时间一起写入 chat_log.json
        appendLog({
          time: new Date().toLocaleString("zh-CN", { hour12: false }), // 当前时间（24 小时制）
          user: message,      // 用户的输入
          assistant: reply    // AI 的回复
        });
        // 把回复以 JSON 格式返回给前端
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ reply }));
      } catch (e) {
        // 出错时（API 报错、网络问题等）返回 500 和错误信息
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: e.message }));
      }
    }); 
    return;
  }

  // 情况 3：其他任何路径 → 返回 404 Not Found
  res.writeHead(404);
  res.end("Not Found");
});

// 启动服务器，开始监听端口
server.listen(PORT, () => {
  console.log(`已启动: http://localhost:${PORT}`);
  console.log(`对话记录将保存到: ${LOG_FILE}`);
});
