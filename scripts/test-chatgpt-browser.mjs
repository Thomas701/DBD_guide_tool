import { BrowserChatGPTProvider } from "./chatgpt-browser-provider.mjs";

const provider = new BrowserChatGPTProvider();
try {
  const status = await provider.checkSession();
  console.log(status.connected ? "Session ChatGPT Browser valide." : "Session ChatGPT Browser absente.");
  process.exitCode = status.connected ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await provider.close();
}
