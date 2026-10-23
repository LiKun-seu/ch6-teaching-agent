/** 对话可选模型。只包含服务端已经接好、并且当前环境能调用的模型，不含密钥。 */
export type ChatModelOption = {
  /** 白名单 id，格式为 `provider:model`。请求里只认这个 id。 */
  id: string;
  provider: "school" | "stepfun" | "agnes";
  /** 上游模型名，来自该通道已配置的对话模型 */
  model: string;
  label: string;
};
