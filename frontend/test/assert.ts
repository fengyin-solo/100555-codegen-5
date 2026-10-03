// 极简断言，失败即抛错带编号。
export function assert(cond: unknown, message: string): asserts cond {
  if (!cond) {
    console.error('✘ ' + message)
    process.exitCode = 1
    throw new Error(message)
  } else {
    console.log('✔ ' + message)
  }
}
