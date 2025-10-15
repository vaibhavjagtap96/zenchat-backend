import httpServer from "./app";
import { port } from "./config";

const PORT = process.env.PORT || port || 5000;

httpServer.listen(PORT, () => {
  console.log(`✅ ZenChat Backend running successfully on port ${PORT}`);
});
