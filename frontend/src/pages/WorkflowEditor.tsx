import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { workflows, type WorkflowTemplate } from "../api";
import { useToast } from "../components/Toast";
import { usePrompt } from "../hooks/usePrompt";

export default function WorkflowEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  // 注意：/workflows/new 路由没有 :id 参数，所以 id 是 undefined
  // /workflows/:id/edit 路由有 :id 参数，所以 id 是实际值
  const isNew = !id;

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [template, setTemplate] = useState<Partial<WorkflowTemplate>>({
    name: "",
    description: "",
    category: "default",
    input_schema: {},
    output_schema: {},
    comfy_workflow: {},
    param_mapping: {},
    enabled: true,
  });
  const { error, warning } = useToast();
  const { prompt, dialog: promptDialog } = usePrompt();

  useEffect(() => {
    if (!isNew && id) {
      loadTemplate();
    }
  }, [id]);

  async function loadTemplate() {
    if (!id) return;

    try {
      setLoading(true);
      const data = await workflows.get(id);
      setTemplate(data);
    } catch (err) {
      error("加载失败: " + (err as Error).message);
      navigate("/workflows");
    } finally {
      setLoading(false);
    }
  }

  async function saveTemplate() {
    if (!template.name?.trim()) {
      warning("请输入工作流名称");
      return;
    }

    if (Object.keys(template.input_schema || {}).length === 0) {
      warning("请至少定义一个输入参数");
      return;
    }

    if (Object.keys(template.param_mapping || {}).length === 0) {
      warning("请至少定义一个参数映射");
      return;
    }

    try {
      setSaving(true);
      if (isNew) {
        await workflows.create({
          name: template.name!,
          description: template.description || "",
          category: template.category || "default",
          input_schema: template.input_schema!,
          output_schema: template.output_schema || {},
          comfy_workflow: template.comfy_workflow || {},
          param_mapping: template.param_mapping || {},
        });
      } else if (id) {
        await workflows.update(id, template);
      }
      navigate("/workflows");
    } catch (err) {
      error("保存失败: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function addInputParam() {
    const key = await prompt({
      message: "参数名称（如: prompt）:",
      placeholder: "prompt",
    });
    if (!key) return;

    const type = await prompt({
      message: "参数类型 (string/integer/number):",
      placeholder: "string",
      defaultValue: "string",
    });
    if (!type) return;

    setTemplate({
      ...template,
      input_schema: {
        ...template.input_schema,
        [key]: { type, required: false, description: "" },
      },
    });
  }

  function removeInputParam(key: string) {
    const newSchema = { ...template.input_schema };
    delete newSchema[key];
    const newMapping = { ...template.param_mapping };
    delete newMapping[key];
    setTemplate({ ...template, input_schema: newSchema, param_mapping: newMapping });
  }

  function updateInputParam(key: string, field: string, value: unknown) {
    setTemplate({
      ...template,
      input_schema: {
        ...template.input_schema,
        [key]: { ...template.input_schema![key], [field]: value },
      },
    });
  }

  function updateParamMapping(key: string, value: string) {
    setTemplate({
      ...template,
      param_mapping: { ...template.param_mapping, [key]: value },
    });
  }

  if (loading) {
    return <div className="text-center py-12">加载中...</div>;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {promptDialog}
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-gray-900">
          {isNew ? "新建工作流模板" : "编辑工作流模板"}
        </h1>
        <button
          onClick={() => navigate("/workflows")}
          className="text-gray-600 hover:text-gray-900"
        >
          返回
        </button>
      </div>

      {/* 基本信息 */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-medium text-gray-900">基本信息</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">名称 *</label>
            <input
              type="text"
              value={template.name}
              onChange={(e) => setTemplate({ ...template, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder="如: 文生图"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">分类</label>
            <input
              type="text"
              value={template.category}
              onChange={(e) => setTemplate({ ...template, category: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder="如: 文生图"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
          <textarea
            value={template.description}
            onChange={(e) => setTemplate({ ...template, description: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            rows={3}
            placeholder="简要描述这个工作流的功能"
          />
        </div>
      </div>

      {/* 输入参数定义 */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-medium text-gray-900">输入参数</h2>
          <button
            onClick={addInputParam}
            className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
          >
            + 添加参数
          </button>
        </div>

        {Object.keys(template.input_schema || {}).length === 0 ? (
          <p className="text-gray-500 text-sm">暂无参数，点击上方按钮添加</p>
        ) : (
          <div className="space-y-3">
            {Object.entries(template.input_schema || {}).map(([key, def]) => (
              <div key={key} className="border border-gray-200 rounded-lg p-4">
                <div className="flex justify-between items-start mb-3">
                  <input
                    type="text"
                    value={key}
                    disabled
                    className="font-mono text-sm bg-gray-50 px-2 py-1 rounded border border-gray-300"
                  />
                  <button
                    onClick={() => removeInputParam(key)}
                    className="text-red-600 hover:text-red-700 text-sm"
                  >
                    删除
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">类型</label>
                    <select
                      value={def.type}
                      onChange={(e) => updateInputParam(key, "type", e.target.value)}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                    >
                      <option value="string">string</option>
                      <option value="integer">integer</option>
                      <option value="number">number</option>
                      <option value="boolean">boolean</option>
                      <option value="array">array</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-gray-600 mb-1">默认值</label>
                    <input
                      type="text"
                      value={String(def.default ?? "")}
                      onChange={(e) => {
                        let val: string | number | boolean = e.target.value;
                        if (def.type === "integer") val = parseInt(String(val)) || 0;
                        if (def.type === "number") val = parseFloat(String(val)) || 0;
                        if (def.type === "boolean") val = val === "true";
                        updateInputParam(key, "default", val);
                      }}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                    />
                  </div>

                  <div className="flex items-center">
                    <label className="flex items-center text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={def.required || false}
                        onChange={(e) => updateInputParam(key, "required", e.target.checked)}
                        className="mr-2"
                      />
                      必填
                    </label>
                  </div>
                </div>

                <div className="mt-3">
                  <label className="block text-xs text-gray-600 mb-1">描述</label>
                  <input
                    type="text"
                    value={def.description || ""}
                    onChange={(e) => updateInputParam(key, "description", e.target.value)}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                    placeholder="参数说明"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 参数映射 */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-medium text-gray-900">参数映射</h2>
        <p className="text-sm text-gray-600">
          将外部参数映射到 ComfyUI workflow 节点。格式: <code className="bg-gray-100 px-1 rounded">节点编号.inputs.字段名</code>
          <br />
          例如: <code className="bg-gray-100 px-1 rounded">6.inputs.text</code> 表示映射到节点 6 的 text 字段
        </p>

        {Object.keys(template.input_schema || {}).length === 0 ? (
          <p className="text-gray-500 text-sm">请先添加输入参数</p>
        ) : (
          <div className="space-y-2">
            {Object.keys(template.input_schema || {}).map((key) => (
              <div key={key} className="flex items-center gap-3">
                <span className="w-32 font-mono text-sm">{key}</span>
                <span className="text-gray-400">→</span>
                <input
                  type="text"
                  value={template.param_mapping?.[key] || ""}
                  onChange={(e) => updateParamMapping(key, e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded font-mono text-sm"
                  placeholder="如: 6.inputs.text"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ComfyUI Workflow */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-medium text-gray-900">ComfyUI Workflow JSON</h2>
        <p className="text-sm text-gray-600">
          从 ComfyUI 导出的 workflow API JSON。可以点击{" "}
          <button
            onClick={() => {
              const example = {
                "3": { "inputs": { "seed": 0 }, "class_type": "KSampler" },
                "4": { "inputs": {}, "class_type": "CheckpointLoaderSimple" }
              };
              setTemplate({ ...template, comfy_workflow: example });
            }}
            className="text-blue-600 hover:underline"
          >
            加载示例
          </button>
        </p>

        <textarea
          value={JSON.stringify(template.comfy_workflow, null, 2)}
          onChange={(e) => {
            try {
              setTemplate({ ...template, comfy_workflow: JSON.parse(e.target.value) });
            } catch {
              // 忽略 JSON 解析错误
            }
          }}
          className="w-full h-64 font-mono text-sm px-3 py-2 border border-gray-300 rounded-lg"
          placeholder='{ "3": { "inputs": {...}, "class_type": "..." } }'
        />
      </div>

      {/* 保存按钮 */}
      <div className="flex justify-end gap-3">
        <button
          onClick={() => navigate("/workflows")}
          className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
        >
          取消
        </button>
        <button
          onClick={saveTemplate}
          disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "保存中..." : "保存"}
        </button>
      </div>
    </div>
  );
}
