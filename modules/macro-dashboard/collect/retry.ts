// 公开数据接口会偶发超时和 5xx。重试两三次就够了；4xx 是请求本身的问题（key 不对、
// series 不存在、写法不对），再试多少次也不会变成 2xx，直接抛出去让调用方看见。
export async function withRetry<T>(tries: number, run: () => Promise<T>): Promise<T> {
  let last: unknown = null;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await run();
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status && status < 500) throw error;
      last = error;
      if (attempt < tries - 1) await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
    }
  }
  throw last;
}

export function httpError(label: string, status: number): Error {
  return Object.assign(new Error(`${label}：HTTP ${status}`), { status });
}
