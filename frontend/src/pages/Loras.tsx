import { useEffect, useState } from "react";
import { loras as api, type LoraItem, type LoraKeyword, type LoraBaseModel, type LoraTriggerWord } from "../api";
import { useToast } from "../components/Toast";
import { useConfirm } from "../hooks/useConfirm";

type TabType = "keywords" | "base-models" | "trigger-words" | "group";

interface AvailableBaseModel {
  filename: string;
  relative_path: string;
  file_size: number;
}

interface LoraGroup {
  id: number;
  group_name: string;
  display_name: string | null;
  description: string | null;
  lora_count: number;
  default_lora_id: number | null;
}

export default function Loras() {
  const [list, setList] = useState<LoraItem[]>([]);
  const [selected, setSelected] = useState<LoraItem | null>(null);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<TabType>("keywords");
  const [scanning, setScanning] = useState(false);
  const { success, error } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();

  // 可用基模列表
  const [availableBaseModels, setAvailableBaseModels] = useState<{
    checkpoints: AvailableBaseModel[];
    diffusion_models: AvailableBaseModel[];
  }>({ checkpoints: [], diffusion_models: [] });

  // LoRA 组列表
  const [groups, setGroups] = useState<LoraGroup[]>([]);

  // 表单状态
  const [createForm, setCreateForm] = useState({
    lora_name: "",
    display_name: "",
    description: "",
    priority: 0,
    enabled: true,
  });

  // 版本标签表单
  const [versionTagForm, setVersionTagForm] = useState({
    group_id: null as number | null,
    version_tag: "",
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
  const [groupLoras, setGroupLoras] = useState<LoraItem[]>([]);

  const loadList = () => {
    api.list({ search: search || undefined })
      .then((r) => setList(r.loras))
      .catch((e) => error(e.message));
  };

  const loadAvailableBaseModels = () => {
    api.getAvailableBaseModels()
      .then((r) => setAvailableBaseModels(r))
      .catch((e) => console.error("加载基模列表失败:", e));
  };

  const loadGroups = () => {
    api.listGroups()
      .then((r) => setGroups(r.groups))
      .catch((e) => console.error("加载组列表失败:", e));
  };

  useEffect(() => {
    loadList();
    loadAvailableBaseModels();
    loadGroups();
  }, [search]);

  // 加载选中 LoRA 的子项
  useEffect(() => {
    if (!selected) {
      setKeywords([]);
      setBaseModels([]);
      setTriggerWords([]);
      setGroupLoras([]);
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

        // 如果有组，加载组内其他 LoRA
        if ((selected as any).group_id) {
          api.getGroupLoras((selected as any).group_id)
            .then((r) => setGroupLoras(r.loras))
            .catch(() => setGroupLoras([]));
        } else {
          setGroupLoras([]);
        }
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

  const handleScan = async () => {
    setScanning(true);
    try {
      const result = await api.scan();
      success(`扫描完成！扫描了 ${result.scanned} 个文件，新增 ${result.added} 个 LoRA，更新 ${result.updated} 个`);
      if (result.errors.length > 0) {
        console.warn("扫描错误:", result.errors);
      }
      loadList();
    } catch (e: any) {
      error(e.message);
    } finally {
      setScanning(false);
    }
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

  // 添加基模关联（从下拉选择）
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

  // 从下拉列表选择基模
  const handleSelectBaseModel = (relativePath: string, folderName: string) => {
    // 自动填充表单
    setBaseModelForm({
      base_model_name: folderName, // 如 "checkpoints" 或 "diffusion_models"
      base_model_filename: relativePath.split("/").pop() || "", // 文件名
      compatible: true,
      notes: "",
    });
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

  // 处理版本标签更新
  const handleUpdateVersion = () => {
    if (!selected) return;

    api.assignLoraGroup(selected.id, {
      group_id: versionTagForm.group_id,
      version_tag: versionTagForm.version_tag || undefined,
    })
      .then((updated) => {
        setSelected(updated);
        success("版本信息已更新");
        loadList();
        loadGroups(); // 刷新组信息
      })
      .catch((e) => error(e.message));
  };

  return (
    <>
      {confirmDialog}

      <div className="flex gap-6">
        {/* 左侧：列表 + 创建表单 */}
        <div className="flex-1">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-semibold text-gray-900">LoRA 管理</h1>
            <button
              onClick={handleScan}
              disabled={scanning}
              className="px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400"
            >
              {scanning ? "扫描中..." : "扫描文件夹"}
            </button>
          </div>

          {/* 创建表单 */}
          <details className="bg-white rounded-lg border p-4 mb-4">
            <summary className="cursor-pointer font-medium text-gray-700">添加新 LoRA</summary>
            <form onSubmit={handleCreate} className="mt-4 space-y-3">
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
          </details>

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

          {/* LoRA 列表（表格） */}
          <div className="bg-white rounded-lg border overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">显示名称</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">文件名</th>
                  <th className="px-4 py-2 text-center text-sm font-medium text-gray-700">关键词</th>
                  <th className="px-4 py-2 text-center text-sm font-medium text-gray-700">基模</th>
                  <th className="px-4 py-2 text-center text-sm font-medium text-gray-700">触发词</th>
                  <th className="px-4 py-2 text-center text-sm font-medium text-gray-700">状态</th>
                  <th className="px-4 py-2 text-center text-sm font-medium text-gray-700">操作</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {list.map((lora) => (
                  <tr
                    key={lora.id}
                    onClick={() => setSelected(lora)}
                    className={`cursor-pointer hover:bg-gray-50 ${
                      selected?.id === lora.id ? "bg-blue-50" : ""
                    }`}
                  >
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{lora.display_name || "-"}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 truncate max-w-xs" title={lora.lora_name}>{lora.lora_name}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 text-center">{lora.keyword_count}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 text-center">{lora.base_model_count}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 text-center">{lora.trigger_word_count}</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUpdateEnabled(lora, !lora.enabled);
                        }}
                        className={`text-xs px-2 py-1 rounded ${
                          lora.enabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {lora.enabled ? "启用" : "禁用"}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(lora.id);
                        }}
                        className="text-red-600 hover:text-red-700 text-sm"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
                {list.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">暂无 LoRA</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 右侧：详情面板 */}
        <div className="w-96 flex-shrink-0">
          {selected ? (
            <div className="bg-white rounded-lg border p-6">
              {/* 基本信息 */}
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-3">基本信息</h2>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="text-gray-500">显示名称:</span>
                    <span className="ml-2 font-medium">{selected.display_name || "-"}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">文件名:</span>
                    <span className="ml-2 font-mono text-xs break-all">{selected.lora_name}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">描述:</span>
                    <span className="ml-2">{selected.description || "-"}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">优先级:</span>
                    <span className="ml-2 font-medium">{selected.priority}</span>
                  </div>
                  {/* 版本标签 */}
                  <div>
                    <span className="text-gray-500">版本标签:</span>
                    {(selected as any).version_tag ? (
                      <span className="ml-2 inline-block px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium">
                        {(selected as any).version_tag}
                      </span>
                    ) : (
                      <span className="ml-2 text-gray-400">未设置</span>
                    )}
                  </div>
                  {/* 组信息 */}
                  <div>
                    <span className="text-gray-500">所属组:</span>
                    {(selected as any).group_id ? (
                      <span className="ml-2 text-blue-600">
                        {groups.find(g => g.id === (selected as any).group_id)?.display_name ||
                         groups.find(g => g.id === (selected as any).group_id)?.group_name}
                      </span>
                    ) : (
                      <span className="ml-2 text-gray-400">未分组</span>
                    )}
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
                    { key: "group" as TabType, label: "版本管理" },
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
                      {/* 从文件夹选择 */}
                      <div>
                        <label className="block text-sm text-gray-600 mb-1">从文件夹选择基模</label>
                        <select
                          className="w-full border rounded px-3 py-2"
                          onChange={(e) => {
                            const value = e.target.value;
                            if (value) {
                              const [folder, path] = value.split(":");
                              handleSelectBaseModel(path, folder);
                            }
                          }}
                          defaultValue=""
                        >
                          <option value="">-- 选择基模 --</option>
                          <optgroup label="Checkpoints">
                            {availableBaseModels.checkpoints.map((bm) => (
                              <option key={bm.relative_path} value={`checkpoints:${bm.relative_path}`}>
                                {bm.filename}
                              </option>
                            ))}
                          </optgroup>
                          <optgroup label="Diffusion Models">
                            {availableBaseModels.diffusion_models.map((bm) => (
                              <option key={bm.relative_path} value={`diffusion_models:${bm.relative_path}`}>
                                {bm.filename}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                      </div>

                      {/* 手动输入 */}
                      <div>
                        <label className="block text-sm text-gray-600 mb-1">或手动输入</label>
                        <input
                          type="text"
                          value={baseModelForm.base_model_name || ""}
                          onChange={(e) => setBaseModelForm((f) => ({ ...f, base_model_name: e.target.value }))}
                          placeholder="基模名称 (如 SD 1.5, SDXL)"
                          className="w-full border rounded px-3 py-2 mb-2"
                        />
                        <input
                          type="text"
                          value={baseModelForm.base_model_filename || ""}
                          onChange={(e) => setBaseModelForm((f) => ({ ...f, base_model_filename: e.target.value }))}
                          placeholder="文件名 (如 v1-5-pruned.safetensors)"
                          className="w-full border rounded px-3 py-2"
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
                      </div>
                      <button type="submit" className="w-full bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
                        添加
                      </button>
                    </form>
                    <div className="space-y-2">
                      {baseModels.map((bm) => (
                        <div key={bm.id} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{bm.base_model_name || bm.base_model_filename || "未知"}</div>
                            <div className="text-xs text-gray-500 truncate">{bm.base_model_filename || bm.base_model_name}</div>
                            {bm.notes && <div className="text-xs text-gray-500 mt-1">{bm.notes}</div>}
                          </div>
                          <div className="flex items-center gap-2 ml-2">
                            <span className={`text-xs px-2 py-0.5 rounded ${bm.compatible ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                              {bm.compatible ? "兼容" : "不兼容"}
                            </span>
                            <button
                              onClick={() => handleDeleteBaseModel(bm.id)}
                              className="text-red-600 hover:text-red-700 text-sm whitespace-nowrap"
                            >
                              删除
                            </button>
                          </div>
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

                {activeTab === "group" && (
                  <div>
                    <div className="space-y-4">
                      {/* 版本标签设置 */}
                      <div className="bg-gray-50 p-4 rounded">
                        <h3 className="font-medium text-gray-900 mb-3">版本标签</h3>
                        <div className="space-y-3">
                          <div>
                            <label className="block text-sm text-gray-600 mb-1">版本标签</label>
                            <input
                              type="text"
                              value={versionTagForm.version_tag}
                              onChange={(e) => setVersionTagForm((f) => ({ ...f, version_tag: e.target.value }))}
                              placeholder="如: low, high, v1, v2"
                              className="w-full border rounded px-3 py-2"
                            />
                            <p className="text-xs text-gray-500 mt-1">用于区分同一组内的不同版本（如 low/high 版本）</p>
                          </div>
                          <button
                            onClick={handleUpdateVersion}
                            className="w-full bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
                          >
                            更新版本信息
                          </button>
                        </div>
                      </div>

                      {/* 组选择 */}
                      <div className="bg-gray-50 p-4 rounded">
                        <h3 className="font-medium text-gray-900 mb-3">LoRA 组</h3>
                        <div className="space-y-3">
                          <div>
                            <label className="block text-sm text-gray-600 mb-1">选择组</label>
                            <select
                              className="w-full border rounded px-3 py-2"
                              value={versionTagForm.group_id || ""}
                              onChange={(e) => setVersionTagForm((f) => ({ ...f, group_id: e.target.value ? parseInt(e.target.value) : null }))}
                            >
                              <option value="">-- 不分组 --</option>
                              {groups.map((g) => (
                                <option key={g.id} value={g.id}>
                                  {g.display_name || g.group_name} ({g.lora_count} 个 LoRA)
                                </option>
                              ))}
                            </select>
                          </div>
                          {(selected as any).group_id && groupLoras.length > 0 && (
                            <div>
                              <label className="block text-sm text-gray-600 mb-2">组内其他版本</label>
                              <div className="space-y-2">
                                {groupLoras.map((l) => (
                                  <div key={l.id} className="flex items-center justify-between p-2 bg-white rounded">
                                    <div className="flex-1 min-w-0">
                                      <div className="text-sm font-medium truncate">
                                        {l.display_name || l.lora_name}
                                      </div>
                                      <div className="text-xs text-gray-500">
                                        {(l as any).version_tag && (
                                          <span className="inline-block px-1 py-0.5 bg-purple-100 text-purple-700 rounded mr-1">
                                            {(l as any).version_tag}
                                          </span>
                                        )}
                                        {l.id === selected.id && "(当前)"}
                                      </div>
                                    </div>
                                    <button
                                      onClick={() => setSelected(l)}
                                      className="text-blue-600 hover:text-blue-700 text-sm ml-2"
                                    >
                                      查看
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 使用说明 */}
                      <div className="bg-blue-50 p-4 rounded">
                        <h3 className="font-medium text-blue-900 mb-2">💡 使用说明</h3>
                        <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
                          <li><strong>版本标签</strong>：用于区分同一功能的不同版本（如 low/high 轻重版本）</li>
                          <li><strong>LoRA 组</strong>：将相关的 LoRA 组织在一起（如同一系列的不同版本）</li>
                          <li>设置组后，可以在"组内其他版本"中快速切换查看同一组的其他 LoRA</li>
                          <li>匹配 API 会返回组的信息，方便调用者选择合适的版本</li>
                        </ul>
                      </div>
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
