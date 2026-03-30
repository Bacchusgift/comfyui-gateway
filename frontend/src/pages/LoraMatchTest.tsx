import { useState } from "react";
import { loras as api, type MatchedLoraInfo } from "../api";
import { useToast } from "../components/Toast";

export default function LoraMatchTest() {
  const [userPrompt, setUserPrompt] = useState("");
  const [baseModel, setBaseModel] = useState("");
  const [checkpoint, setCheckpoint] = useState("");
  const [limit, setLimit] = useState(10);
  const [minScore, setMinScore] = useState(0.0);
  const [results, setResults] = useState<MatchedLoraInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [executionTime, setExecutionTime] = useState<number | null>(null);
  const { error } = useToast();

  const handleMatch = async () => {
    if (!userPrompt.trim()) {
      error("请输入用户提示词");
      return;
    }

    setLoading(true);
    setResults([]);
    setExecutionTime(null);

    try {
      const response = await api.match({
        user_prompt: userPrompt.trim(),
        base_model: baseModel.trim() || undefined,
        checkpoint: checkpoint.trim() || undefined,
        limit,
        min_score: minScore,
      });

      setResults(response.matched_loras);
      setExecutionTime(response.execution_time_ms);
    } catch (e: any) {
      error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-xl font-semibold text-gray-900 mb-6">LoRA 匹配测试</h1>

      {/* 测试表单 */}
      <div className="bg-white rounded-lg border p-6 mb-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            用户提示词 *
          </label>
          <textarea
            value={userPrompt}
            onChange={(e) => setUserPrompt(e.target.value)}
            placeholder="例如：我想画一个打篮球的场景"
            rows={3}
            className="w-full border rounded px-3 py-2"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              基模名称（可选）
            </label>
            <input
              type="text"
              value={baseModel}
              onChange={(e) => setBaseModel(e.target.value)}
              placeholder="例如：SD 1.5, SDXL"
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              基模文件名（可选）
            </label>
            <input
              type="text"
              value={checkpoint}
              onChange={(e) => setCheckpoint(e.target.value)}
              placeholder="例如：v1-5-pruned.safetensors"
              className="w-full border rounded px-3 py-2"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              返回数量限制
            </label>
            <input
              type="number"
              min={1}
              max={100}
              value={limit}
              onChange={(e) => setLimit(parseInt(e.target.value, 10) || 10)}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              最低匹配分数
            </label>
            <input
              type="number"
              step="0.1"
              min={0}
              max={1}
              value={minScore}
              onChange={(e) => setMinScore(parseFloat(e.target.value) || 0)}
              className="w-full border rounded px-3 py-2"
            />
          </div>
        </div>

        <button
          onClick={handleMatch}
          disabled={loading}
          className="w-full bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-gray-400"
        >
          {loading ? "匹配中..." : "匹配"}
        </button>
      </div>

      {/* 执行时间 */}
      {executionTime !== null && (
        <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-4 text-sm text-blue-800">
          执行时间: {executionTime} ms | 匹配结果: {results.length} 个
        </div>
      )}

      {/* 匹配结果 */}
      {results.length > 0 && (
        <div className="space-y-4">
          {results.map((lora) => (
            <div key={lora.lora_id} className="bg-white rounded-lg border p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-gray-900">
                    {lora.display_name || lora.lora_name}
                  </h3>
                  <p className="text-sm text-gray-500">{lora.lora_name}</p>
                  {lora.description && (
                    <p className="text-sm text-gray-600 mt-1">{lora.description}</p>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-blue-600">
                    {(lora.match_score * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-gray-500">匹配分数</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm mb-3">
                <div>
                  <span className="text-gray-500">基模:</span>
                  <span className="ml-2 font-medium">{lora.base_model}</span>
                </div>
                <div>
                  <span className="text-gray-500">优先级:</span>
                  <span className="ml-2 font-medium">{lora.priority}</span>
                </div>
              </div>

              {/* 匹配的关键词 */}
              {lora.matched_keywords.length > 0 && (
                <div className="mb-3">
                  <div className="text-sm text-gray-500 mb-1">匹配的关键词:</div>
                  <div className="flex flex-wrap gap-2">
                    {lora.matched_keywords.map((kw, i) => (
                      <span
                        key={i}
                        className="px-2 py-1 bg-green-100 text-green-700 rounded text-sm"
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 触发词 */}
              {lora.trigger_words.length > 0 && (
                <div>
                  <div className="text-sm text-gray-500 mb-1">触发词（用于 ComfyUI 提示词）:</div>
                  <div className="flex flex-wrap gap-2">
                    {lora.trigger_words.map((tw, i) => (
                      <span
                        key={i}
                        className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-sm font-mono"
                      >
                        {tw}
                        {lora.trigger_weights[i] !== 1 && ` (${lora.trigger_weights[i]})`}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Civitai 预览图 */}
              {lora.civitai_preview_url && (
                <div className="mt-3">
                  <img
                    src={lora.civitai_preview_url}
                    alt="Preview"
                    className="max-w-xs rounded border"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 无结果 */}
      {!loading && executionTime !== null && results.length === 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded p-6 text-center text-yellow-800">
          未找到匹配的 LoRA
          <div className="text-sm mt-2">
            请尝试：
            <ul className="list-disc list-inside mt-1 text-left inline-block">
              <li>调整用户提示词</li>
              <li>降低最低匹配分数</li>
              <li>检查基模配置是否正确</li>
              <li>确认已配置相关 LoRA 和关键词</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
