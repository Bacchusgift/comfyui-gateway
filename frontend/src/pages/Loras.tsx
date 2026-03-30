import { useEffect, useState } from "react";
import { loras as api, type LoraItem, type LoraKeyword, type LoraBaseModel, type LoraTriggerWord } from "../api";
import { useToast } from "../components/Toast";
import { useConfirm } from "../hooks/useConfirm";

type TabType = "keywords" | "base-models" | "trigger-words";

export default function Loras() {
  const [list, setList] = useState<LoraItem[]>([]);
  const [selected, setSelected] = useState<LoraItem | null>(null);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<TabType>("keywords");
  const { success, error } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();

  // 表单状态
  const [createForm, setCreateForm] = useState({
    lora_name: "",
    display_name: "",
    description: "",
    priority: 0,
    enabled: true,
  });

  // 关键词表单
  const [keywordForm, setKeywordForm] = useState({ keyword: "", weight: 1.0 });

  // 基模关联表单
  const [baseModelForm, setBaseModelForm] = useState({
    base_model_name: "",
    base_model_filename: "",
    compatible: true,
    notes: "",
  });

  // 触发词表单
  const [triggerWordForm, setTriggerWordForm] = useState({
    trigger_word: "",
    weight: 1.0,
    is_negative: false,
  });

  // 子项列表
  const [keywords, setKeywords] = useState<LoraKeyword[]>([]);
  const [baseModels, setBaseModels] = useState<LoraBaseModel[]>([]);
  const [triggerWords, setTriggerWords] = useState<LoraTriggerWord[]>([]);

  const loadList = () => {
    api.list({ search: search || undefined })
      .then((r) => setList(r.loras))
      .catch((e) => error(e.message));
  };

  useEffect(() => {
    loadList();
  }, [search]);

  // 加载选中 LoRA 的子项
  useEffect(() => {
    if (!selected) {
      setKeywords([]);
      setBaseModels([]);
      setTriggerWords([]);
      return;
    }

    const loadSubItems = async () => {
      try {
        const [kwRes, bmRes, twRes] = await Promise.all([
          api.getKeywords(selected.id),
          api.getBaseModels(selected.id),
          api.getTriggerWords(selected.id),
        ]);
        setKeywords(kwRes.keywords);
        setBaseModels(bmRes.base_models);
        setTriggerWords(twRes.trigger_words);
      } catch (e: any) {
        error(e.message);
      }
    };

    loadSubItems();
  }, [selected]);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.lora_name.trim()) return;

    api.create({
      lora_name: createForm.lora_name.trim(),
      display_name: createForm.display_name.trim() || undefined,
      description: createForm.description.trim() || undefined,
      priority: createForm.priority,
      enabled: createForm.enabled,
    })
      .then(() => {
        setCreateForm({ lora_name: "", display_name: "", description: "", priority: 0, enabled: true });
        success("LoRA 创建成功");
        loadList();
      })
      .catch((e) => error(e.message));
  };

  const handleDelete = async (id: number) => {
    const ok = await confirm({
      title: "删除确认",
      message: "确定删除该 LoRA？相关的关键词、基模关联、触发词也会被删除。",
      variant: "danger",
    });
    if (!ok) return;

    api.delete(id)
      .then(() => {
        success("LoRA 已删除");
        if (selected?.id === id) setSelected(null);
        loadList();
      })
      .catch((e) => error(e.message));
  };

  const handleUpdateEnabled = (lora: LoraItem, enabled: boolean) => {
    api.update(lora.id, { enabled })
      .then(() => {
        success(enabled ? "已启用" : "已禁用");
        loadList();
        if (selected?.id === lora.id) {
          setSelected({ ...lora, enabled });
        }
      })
      .catch((e) => error(e.message));
  };

  // 添加关键词
  const handleAddKeyword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !keywordForm.keyword.trim()) return;

    api.addKeyword(selected.id, {
      keyword: keywordForm.keyword.trim(),
      weight: keywordForm.weight,
    })
      .then((res) => {
        setKeywords(res.keywords);
        setKeywordForm({ keyword: "", weight: 1.0 });
        success("关键词已添加");
        loadList();
      })
      .catch((e) => error(e.message));
  };

  const handleDeleteKeyword = (keywordId: number) => {
    if (!selected) return;
    api.deleteKeyword(selected.id, keywordId)
      .then(() => {
        setKeywords(keywords.filter((k) => k.id !== keywordId));
        success("关键词已删除");
        loadList();
      })
      .catch((e) => error(e.message));
  };

  // 添加基模关联
  const handleAddBaseModel = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;

    api.addBaseModel(selected.id, {
      base_model_name: baseModelForm.base_model_name.trim() || undefined,
      base_model_filename: baseModelForm.base_model_filename.trim() || undefined,
      compatible: baseModelForm.compatible,
      notes: baseModelForm.notes.trim() || undefined,
    })
      .then((res) => {
        setBaseModels(res.base_models);
        setBaseModelForm({ base_model_name: "", base_model_filename: "", compatible: true, notes: "" });
        success("基模关联已添加");
        loadList();
      })
      .catch((e) => error(e.message));
  };

  const handleDeleteBaseModel = (assocId: number) => {
    if (!selected) return;
    api.deleteBaseModel(selected.id, assocId)
      .then(() => {
        setBaseModels(baseModels.filter((b) => b.id !== assocId));
        success("基模关联已删除");
        loadList();
      })
      .catch((e) => error(e.message));
  };

  // 添加触发词
  const handleAddTriggerWord = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !triggerWordForm.trigger_word.trim()) return;

    api.addTriggerWord(selected.id, {
      trigger_word: triggerWordForm.trigger_word.trim(),
      weight: triggerWordForm.weight,
      is_negative: triggerWordForm.is_negative,
    })
      .then((res) => {
        setTriggerWords(res.trigger_words);
        setTriggerWordForm({ trigger_word: "", weight: 1.0, is_negative: false });
        success("触发词已添加");
        loadList();
      })
      .catch((e) => error(e.message));
  };

  const handleDeleteTriggerWord = (twId: number) => {
    if (!selected) return;
    api.deleteTriggerWord(selected.id, twId)
      .then(() => {
        setTriggerWords(triggerWords.filter((t) => t.id !== twId));
        success("触发词已删除");
        loadList();
      })
      .catch((e) => error(e.message));
  };

  return (
    <>
      {confirmDialog}

      <div className="flex gap-6">
        {/* 左侧：列表 + 创建表单 */}
        <div className="w-96 flex-shrink-0">
          <h1 className="text-xl font-semibold text-gray-900 mb-4">LoRA 管理</h1>

          {/* 创建表单 */}
          <form onSubmit={handleCreate} className="bg-white rounded-lg border p-4 mb-4 space-y-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">文件名 *</label>
              <input
                type="text"
                value={createForm.lora_name}
                onChange={(e) => setCreateForm((f) => ({ ...f, lora_name: e.target.value }))}
                placeholder="如: sports_better.safetensors"
                className="w-full border rounded px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">显示名称</label>
              <input
                type="text"
                value={createForm.display_name}
                onChange={(e) => setCreateForm((f) => ({ ...f, display_name: e.target.value }))}
                placeholder="如: 运动增强"
                className="w-full border rounded px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">描述</label>
              <input
                type="text"
                value={createForm.description}
                onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="功能描述"
                className="w-full border rounded px-3 py-2"
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-sm text-gray-600 mb-1">优先级</label>
                <input
                  type="number"
                  min={0}
                  value={createForm.priority}
                  onChange={(e) => setCreateForm((f) => ({ ...f, priority: parseInt(e.target.value, 10) || 0 }))}
                  className="w-full border rounded px-3 py-2"
                />
              </div>
              <div className="flex items-center pb-2">
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={createForm.enabled}
                    onChange={(e) => setCreateForm((f) => ({ ...f, enabled: e.target.checked }))}
                    className="h-4 w-4 text-blue-600"
                  />
                  启用
                </label>
              </div>
            </div>
            <button type="submit" className="w-full bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
              添加 LoRA
            </button>
          </form>

          {/* 搜索框 */}
          <div className="mb-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索 LoRA..."
              className="w-full border rounded px-3 py-2"
            />
          </div>

          {/* 列表 */}
          <div className="bg-white rounded-lg border overflow-hidden">
            {list.map((lora) => (
              <div
                key={lora.id}
                onClick={() => setSelected(lora)}
                className={`px-4 py-3 border-b last:border-b-0 cursor-pointer hover:bg-gray-50 ${
                  selected?.id === lora.id ? "bg-blue-50" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 truncate">{lora.display_name || lora.lora_name}</div>
                    <div className="text-sm text-gray-500 truncate">{lora.lora_name}</div>
                  </div>
                  <div className="flex items-center gap-2 ml-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${lora.enabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                      {lora.enabled ? "启用" : "禁用"}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(lora.id);
                      }}
                      className="text-red-600 hover:text-red-700 text-sm"
                    >
                      删除
                    </button>
                  </div>
                </div>
                <div className="flex gap-3 mt-1 text-xs text-gray-500">
                  <span>关键词: {lora.keyword_count}</span>
                  <span>基模: {lora.base_model_count}</span>
                  <span>触发词: {lora.trigger_word_count}</span>
                </div>
              </div>
            ))}
            {list.length === 0 && (
              <div className="px-4 py-8 text-center text-gray-500">暂无 LoRA</div>
            )}
          </div>
        </div>

        {/* 右侧：详情面板 */}
        <div className="flex-1">
          {selected ? (
            <div className="bg-white rounded-lg border p-6">
              {/* 基本信息 */}
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-3">基本信息</h2>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">显示名称:</span>
                    <span className="ml-2 font-medium">{selected.display_name || "-"}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">文件名:</span>
                    <span className="ml-2 font-medium">{selected.lora_name}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-gray-500">描述:</span>
                    <span className="ml-2">{selected.description || "-"}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">优先级:</span>
                    <span className="ml-2 font-medium">{selected.priority}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">状态:</span>
                    <button
                      onClick={() => handleUpdateEnabled(selected, !selected.enabled)}
                      className={`ml-2 px-2 py-0.5 rounded text-xs ${
                        selected.enabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {selected.enabled ? "已启用" : "已禁用"}
                    </button>
                  </div>
                </div>
              </div>

              {/* Tab 切换 */}
              <div className="border-b">
                <nav className="flex gap-4">
                  {[
                    { key: "keywords" as TabType, label: "关键词" },
                    { key: "base-models" as TabType, label: "基模关联" },
                    { key: "trigger-words" as TabType, label: "触发词" },
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setActiveTab(tab.key)}
                      className={`pb-2 px-1 border-b-2 text-sm font-medium ${
                        activeTab === tab.key
                          ? "border-blue-600 text-blue-600"
                          : "border-transparent text-gray-500 hover:text-gray-700"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </nav>
              </div>

              {/* Tab 内容 */}
              <div className="mt-4">
                {activeTab === "keywords" && (
                  <div>
                    <form onSubmit={handleAddKeyword} className="flex gap-2 mb-4">
                      <input
                        type="text"
                        value={keywordForm.keyword}
                        onChange={(e) => setKeywordForm((f) => ({ ...f, keyword: e.target.value }))}
                        placeholder="关键词"
                        className="flex-1 border rounded px-3 py-2"
                      />
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="1"
                        value={keywordForm.weight}
                        onChange={(e) => setKeywordForm((f) => ({ ...f, weight: parseFloat(e.target.value) || 0 }))}
                        placeholder="权重"
                        className="w-20 border rounded px-3 py-2"
                      />
                      <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
                        添加
                      </button>
                    </form>
                    <div className="space-y-2">
                      {keywords.map((kw) => (
                        <div key={kw.id} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                          <div>
                            <span className="font-medium">{kw.keyword}</span>
                            <span className="ml-2 text-sm text-gray-500">权重: {kw.weight}</span>
                          </div>
                          <button
                            onClick={() => handleDeleteKeyword(kw.id)}
                            className="text-red-600 hover:text-red-700 text-sm"
                          >
                            删除
                          </button>
                        </div>
                      ))}
                      {keywords.length === 0 && (
                        <div className="text-center text-gray-500 py-4">暂无关键词</div>
                      )}
                    </div>
                  </div>
                )}

                {activeTab === "base-models" && (
                  <div>
                    <form onSubmit={handleAddBaseModel} className="space-y-3 mb-4">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={baseModelForm.base_model_name}
                          onChange={(e) => setBaseModelForm((f) => ({ ...f, base_model_name: e.target.value }))}
                          placeholder="基模名称 (如 SD 1.5, SDXL)"
                          className="flex-1 border rounded px-3 py-2"
                        />
                        <input
                          type="text"
                          value={baseModelForm.base_model_filename}
                          onChange={(e) => setBaseModelForm((f) => ({ ...f, base_model_filename: e.target.value }))}
                          placeholder="文件名 (如 v1-5-pruned.safetensors)"
                          className="flex-1 border rounded px-3 py-2"
                        />
                      </div>
                      <div className="flex gap-2 items-center">
                        <label className="flex items-center gap-2 text-sm text-gray-600">
                          <input
                            type="checkbox"
                            checked={baseModelForm.compatible}
                            onChange={(e) => setBaseModelForm((f) => ({ ...f, compatible: e.target.checked }))}
                            className="h-4 w-4 text-blue-600"
                          />
                          兼容
                        </label>
                        <input
                          type="text"
                          value={baseModelForm.notes}
                          onChange={(e) => setBaseModelForm((f) => ({ ...f, notes: e.target.value }))}
                          placeholder="备注"
                          className="flex-1 border rounded px-3 py-2"
                        />
                        <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
                          添加
                        </button>
                      </div>
                    </form>
                    <div className="space-y-2">
                      {baseModels.map((bm) => (
                        <div key={bm.id} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                          <div>
                            <span className="font-medium">{bm.base_model_name || bm.base_model_filename || "未知"}</span>
                            <span className={`ml-2 text-xs px-2 py-0.5 rounded ${bm.compatible ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                              {bm.compatible ? "兼容" : "不兼容"}
                            </span>
                            {bm.notes && <span className="ml-2 text-sm text-gray-500">{bm.notes}</span>}
                          </div>
                          <button
                            onClick={() => handleDeleteBaseModel(bm.id)}
                            className="text-red-600 hover:text-red-700 text-sm"
                          >
                            删除
                          </button>
                        </div>
                      ))}
                      {baseModels.length === 0 && (
                        <div className="text-center text-gray-500 py-4">暂无基模关联</div>
                      )}
                    </div>
                  </div>
                )}

                {activeTab === "trigger-words" && (
                  <div>
                    <form onSubmit={handleAddTriggerWord} className="flex gap-2 mb-4">
                      <input
                        type="text"
                        value={triggerWordForm.trigger_word}
                        onChange={(e) => setTriggerWordForm((f) => ({ ...f, trigger_word: e.target.value }))}
                        placeholder="触发词"
                        className="flex-1 border rounded px-3 py-2"
                      />
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="1"
                        value={triggerWordForm.weight}
                        onChange={(e) => setTriggerWordForm((f) => ({ ...f, weight: parseFloat(e.target.value) || 0 }))}
                        placeholder="权重"
                        className="w-20 border rounded px-3 py-2"
                      />
                      <label className="flex items-center gap-2 text-sm text-gray-600">
                        <input
                          type="checkbox"
                          checked={triggerWordForm.is_negative}
                          onChange={(e) => setTriggerWordForm((f) => ({ ...f, is_negative: e.target.checked }))}
                          className="h-4 w-4 text-blue-600"
                        />
                        负向
                      </label>
                      <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
                        添加
                      </button>
                    </form>
                    <div className="space-y-2">
                      {triggerWords.map((tw) => (
                        <div key={tw.id} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                          <div>
                            <span className="font-medium">{tw.trigger_word}</span>
                            <span className="ml-2 text-sm text-gray-500">权重: {tw.weight}</span>
                            {tw.is_negative && (
                              <span className="ml-2 text-xs px-2 py-0.5 rounded bg-red-100 text-red-700">负向</span>
                            )}
                          </div>
                          <button
                            onClick={() => handleDeleteTriggerWord(tw.id)}
                            className="text-red-600 hover:text-red-700 text-sm"
                          >
                            删除
                          </button>
                        </div>
                      ))}
                      {triggerWords.length === 0 && (
                        <div className="text-center text-gray-500 py-4">暂无触发词</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-lg border p-12 text-center text-gray-500">
              请选择一个 LoRA 查看详情
            </div>
          )}
        </div>
      </div>
    </>
  );
}
