import { getHandlers } from '../server/vercel.mjs';

export default async function handler(request, response) {
  const handlers = await getHandlers();
  return handlers.status(request, response);
}
