import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { handleAccountRequest } from "../../../../server/profile.mjs";

export const dynamic = "force-dynamic";

async function account(request: Request) {
  const user = await getChatGPTUser();
  return handleAccountRequest(request, user, env.DB);
}

export const GET = account;
export const PUT = account;
