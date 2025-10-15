import dotenv from "dotenv";
dotenv.config();

// ✅ Environment and Server Config
export const environment = process.env.NODE_ENV || "development";
export const port = process.env.PORT || "5000";
export const serverUrl = process.env.SERVER_URL?.trim() || "http://localhost:5000";

// ✅ Database Config
export const db = {
  name: process.env.DB_NAME || "ZenChat",
  url: process.env.DB_URL || "",
  minPoolSize: parseInt(process.env.DB_MIN_POOL_SIZE || "2"),
  maxPoolSize: parseInt(process.env.DB_MAX_POOL_SIZE || "5"),
};

// ✅ CORS Configuration (array-safe and Render-ready)
export const corsUrl: string[] = process.env.CORS_URL
  ? process.env.CORS_URL.split(",").map((url) => url.trim())
  : ["http://localhost:5173"];

console.log("✅ Allowed CORS Origins:", corsUrl);

// ✅ Cookie Validity
export const cookieValidity = process.env.COOKIE_VALIDITY_SEC || "172800"; // default 2 days

// ✅ JWT and Token Configuration
export const tokenInfo = {
  jwtSecretKey: process.env.JWT_SECRET_KEY || "",
  accessTokenValidity: parseInt(process.env.ACCESS_TOKEN_VALIDITY_SEC || "182800"),
  refreshTokenValidity: parseInt(process.env.REFRESH_TOKEN_VALIDITY_SEC || "604800"),
  issuer: process.env.TOKEN_ISSUER || serverUrl,
  audience: process.env.TOKEN_AUDIENCE || corsUrl[0],
};
