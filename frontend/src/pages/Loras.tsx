import { useEffect, useState } from "react";
import { loras as api, type LoraItem, type LoraKeyword, type LoraBaseModel, type LoraTriggerWord } from "../api";
import {
  Table,
  Button,
  Input,
  Space,
  Tag,
  Switch,
  Modal,
  Form,
  Select,
  InputNumber,
  Card,
  Tabs,
  Typography,
  Divider,
  Popconfirm,
  message,
  Tooltip,
  Badge,
  Descriptions,
  Empty,
} from "antd";
import {
  PlusOutlined,
  ScanOutlined,
  EditOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  TagsFilled,
  AppstoreOutlined,
  ThunderboltOutlined,
  RocketOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

const { TextArea } = Input;
const { Search } = Input;
const { Title, Text } = Typography;

interface LoraGroup {
  id: number;
  group_name: string;
  display_name: string | null;
  description: string | null;
  lora_count: number;
  default_lora_id: number | null;
}

interface AvailableBaseModel {
  filename: string;
  relative_path: string;
  file_size: number;
}

export default function Loras() {
  // 状态管理
  const [list, setList] = useState<LoraItem[]>([]);
  const [selected, setSelected] = useState<LoraItem | null>(null);
  const [searchText, setSearchText] = useState("");
  const [scanning, setScanning] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingLora, setEditingLora] = useState<LoraItem | null>(null);

  // 可用基模列表
  const [availableBaseModels, setAvailableBaseModels] = useState<{
    checkpoints: AvailableBaseModel[];
    diffusion_models: AvailableBaseModel[];
  }>({ checkpoints: [], diffusion_models: [] });

  // LoRA 组列表
  const [groups, setGroups] = useState<LoraGroup[]>([]);
  const [groupLoras, setGroupLoras] = useState<LoraItem[]>([]);

  // 表单
  const [form] = Form.useForm();
  const [keywordForm] = Form.useForm();
  const [baseModelForm] = Form.useForm();
  const [triggerWordForm] = Form.useForm();
  const [versionForm] = Form.useForm();

  // 子项数据
  const [keywords, setKeywords] = useState<LoraKeyword[]>([]);
  const [baseModels, setBaseModels] = useState<LoraBaseModel[]>([]);
  const [triggerWords, setTriggerWords] = useState<LoraTriggerWord[]>([]);

  // 加载数据
  const loadList = () => {
    api.list({ search: searchText || undefined })
      .then((r) => setList(r.loras))
      .catch((e) => message.error(e.message));
  };

  const loadAvailableBaseModels = () => {
    api.getAvailableBaseModels()
      .then((r) => setAvailableBaseModels(r))
      .catch(() => message.error("加载基模列表失败"));
  };

  const loadGroups = () => {
    api.listGroups()
      .then((r) => setGroups(r.groups))
      .catch(() => message.error("加载组列表失败"));
  };

  useEffect(() => {
    loadList();
    loadAvailableBaseModels();
    loadGroups();
  }, [searchText]);

  // 加载选中 LoRA 的详细数据
  useEffect(() => {
    if (!selected) {
      setKeywords([]);
      setBaseModels([]);
      setTriggerWords([]);
      setGroupLoras([]);
      return;
    }

    const loadData = async () => {
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
        }
      } catch (e: any) {
        message.error(e.message);
      }
    };

    loadData();
  }, [selected]);

  // 事件处理
  const handleScan = async () => {
    setScanning(true);
    try {
      const result = await api.scan();
      message.success(`扫描完成！扫描了 ${result.scanned} 个文件，新增 ${result.added} 个 LoRA，更新 ${result.updated} 个`);
      loadList();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setScanning(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(id);
      message.success("LoRA 已删除");
      if (selected?.id === id) setSelected(null);
      loadList();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleToggleEnabled = async (lora: LoraItem, enabled: boolean) => {
    try {
      await api.update(lora.id, { enabled });
      message.success(enabled ? "已启用" : "已禁用");
      loadList();
      if (selected?.id === lora.id) {
        setSelected({ ...lora, enabled });
      }
    } catch (e: any) {
      message.error(e.message);
    }
  };

  // 关键词管理
  const handleAddKeyword = async () => {
    if (!selected) return;
    try {
      const values = await keywordForm.validateFields();
      await api.addKeyword(selected.id, values);
      message.success("关键词已添加");
      keywordForm.resetFields();
      const res = await api.getKeywords(selected.id);
      setKeywords(res.keywords);
      loadList();
    } catch (e: any) {
      if (e.errorFields) return;
      message.error(e.message);
    }
  };

  const handleDeleteKeyword = async (keywordId: number) => {
    if (!selected) return;
    try {
      await api.deleteKeyword(selected.id, keywordId);
      message.success("关键词已删除");
      const res = await api.getKeywords(selected.id);
      setKeywords(res.keywords);
      loadList();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  // 基模关联管理
  const handleAddBaseModel = async () => {
    if (!selected) return;
    try {
      const values = await baseModelForm.validateFields();
      await api.addBaseModel(selected.id, values);
      message.success("基模关联已添加");
      baseModelForm.resetFields();
      const res = await api.getBaseModels(selected.id);
      setBaseModels(res.base_models);
      loadList();
    } catch (e: any) {
      if (e.errorFields) return;
      message.error(e.message);
    }
  };

  const handleSelectBaseModel = (value: string) => {
    const [folder, path] = value.split(":");
    baseModelForm.setFieldsValue({
      base_model_name: folder,
      base_model_filename: path.split("/").pop(),
    });
  };

  const handleDeleteBaseModel = async (assocId: number) => {
    if (!selected) return;
    try {
      await api.deleteBaseModel(selected.id, assocId);
      message.success("基模关联已删除");
      const res = await api.getBaseModels(selected.id);
      setBaseModels(res.base_models);
      loadList();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  // 触发词管理
  const handleAddTriggerWord = async () => {
    if (!selected) return;
    try {
      const values = await triggerWordForm.validateFields();
      await api.addTriggerWord(selected.id, values);
      message.success("触发词已添加");
      triggerWordForm.resetFields();
      const res = await api.getTriggerWords(selected.id);
      setTriggerWords(res.trigger_words);
      loadList();
    } catch (e: any) {
      if (e.errorFields) return;
      message.error(e.message);
    }
  };

  const handleDeleteTriggerWord = async (twId: number) => {
    if (!selected) return;
    try {
      await api.deleteTriggerWord(selected.id, twId);
      message.success("触发词已删除");
      const res = await api.getTriggerWords(selected.id);
      setTriggerWords(res.trigger_words);
      loadList();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  // 版本管理
  const handleUpdateVersion = async () => {
    if (!selected) return;
    try {
      const values = await versionForm.validateFields();
      await api.assignLoraGroup(selected.id, {
        group_id: values.group_id || null,
        version_tag: values.version_tag || undefined,
      });
      message.success("版本信息已更新");
      const updated = await api.get(selected.id);
      setSelected(updated);
      loadList();
      loadGroups();
    } catch (e: any) {
      if (e.errorFields) return;
      message.error(e.message);
    }
  };

  // 表格列定义
  const columns: ColumnsType<LoraItem> = [
    {
      title: "显示名称",
      dataIndex: "display_name",
      key: "display_name",
      width: 150,
      render: (text) => text || "-",
      ellipsis: true,
    },
    {
      title: "文件名",
      dataIndex: "lora_name",
      key: "lora_name",
      width: 200,
      ellipsis: true,
      render: (text: string) => (
        <Tooltip title={text}>
          <span className="font-mono text-xs">{text}</span>
        </Tooltip>
      ),
    },
    {
      title: "版本",
      key: "version",
      width: 100,
      render: (_, record) => (record as any).version_tag ? (
        <Tag color="purple">{(record as any).version_tag}</Tag>
      ) : (
        <Text type="secondary">-</Text>
      ),
    },
    {
      title: "关键词",
      dataIndex: "keyword_count",
      key: "keyword_count",
      width: 80,
      align: "center",
      render: (count) => <Badge count={count} showZero color="blue" />,
    },
    {
      title: "基模",
      dataIndex: "base_model_count",
      key: "base_model_count",
      width: 80,
      align: "center",
      render: (count) => <Badge count={count} showZero color="green" />,
    },
    {
      title: "触发词",
      dataIndex: "trigger_word_count",
      key: "trigger_word_count",
      width: 80,
      align: "center",
      render: (count) => <Badge count={count} showZero color="orange" />,
    },
    {
      title: "状态",
      dataIndex: "enabled",
      key: "enabled",
      width: 80,
      render: (enabled, record) => (
        <Switch
          checked={enabled}
          onChange={(checked) => handleToggleEnabled(record, checked)}
          checkedChildren="启用"
          unCheckedChildren="禁用"
          size="small"
        />
      ),
    },
    {
      title: "操作",
      key: "action",
      width: 120,
      fixed: "right" as const,
      render: (_, record) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => {
              setEditingLora(record);
              form.setFieldsValue(record);
              setModalVisible(true);
            }}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定删除？"
            description="相关的关键词、基模关联、触发词也会被删除"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const tabItems = [
    {
      key: "keywords",
      label: (
        <span>
          <TagsFilled /> 关键词
        </span>
      ),
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <Form form={keywordForm} layout="inline">
            <Form.Item name="keyword" rules={[{ required: true, message: "请输入关键词" }]}>
              <Input placeholder="关键词" style={{ width: 200 }} />
            </Form.Item>
            <Form.Item name="weight" initialValue={1.0}>
              <InputNumber min={0} max={1} step={0.1} placeholder="权重" style={{ width: 100 }} />
            </Form.Item>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAddKeyword}>
              添加
            </Button>
          </Form>
          <Card size="small">
            {keywords.length === 0 ? (
              <Empty description="暂无关键词" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <Space direction="vertical" style={{ width: "100%" }} size="small">
                {keywords.map((kw) => (
                  <div key={kw.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                    <Space>
                      <Text strong>{kw.keyword}</Text>
                      <Tag color="blue">权重: {kw.weight}</Tag>
                    </Space>
                    <Button
                      type="link"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => handleDeleteKeyword(kw.id)}
                    >
                      删除
                    </Button>
                  </div>
                ))}
              </Space>
            )}
          </Card>
        </Space>
      ),
    },
    {
      key: "base-models",
      label: (
        <span>
          <AppstoreOutlined /> 基模关联
        </span>
      ),
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <Card size="small" title="从文件夹选择">
            <Form form={baseModelForm} layout="vertical">
              <Form.Item label="选择基模">
                <Select
                  placeholder="选择基模文件"
                  showSearch
                  optionFilterProp="children"
                  onChange={handleSelectBaseModel}
                >
                  <Select.OptGroup label="Checkpoints">
                    {availableBaseModels.checkpoints.map((bm) => (
                      <Select.Option key={bm.relative_path} value={`checkpoints:${bm.relative_path}`}>
                        {bm.filename}
                      </Select.Option>
                    ))}
                  </Select.OptGroup>
                  <Select.OptGroup label="Diffusion Models">
                    {availableBaseModels.diffusion_models.map((bm) => (
                      <Select.Option key={bm.relative_path} value={`diffusion_models:${bm.relative_path}`}>
                        {bm.filename}
                      </Select.Option>
                    ))}
                  </Select.OptGroup>
                </Select>
              </Form.Item>
              <Divider plain>或手动输入</Divider>
              <Form.Item name="base_model_name" label="基模名称">
                <Input placeholder="如 SD 1.5, SDXL" />
              </Form.Item>
              <Form.Item name="base_model_filename" label="文件名">
                <Input placeholder="如 v1-5-pruned.safetensors" />
              </Form.Item>
              <Form.Item name="compatible" valuePropName="checked" initialValue>
                <Switch checkedChildren="兼容" unCheckedChildren="不兼容" />
              </Form.Item>
              <Form.Item name="notes" label="备注">
                <Input placeholder="可选备注" />
              </Form.Item>
              <Button type="primary" htmlType="submit" icon={<PlusOutlined />} onClick={handleAddBaseModel} block>
                添加基模关联
              </Button>
            </Form>
          </Card>

          <Card size="small" title="已关联的基模">
            {baseModels.length === 0 ? (
              <Empty description="暂无基模关联" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <Space direction="vertical" style={{ width: "100%" }} size="small">
                {baseModels.map((bm) => (
                  <div key={bm.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                    <Space direction="vertical" size="small">
                      <Text strong>{bm.base_model_name || bm.base_model_filename || "未知"}</Text>
                      <Text type="secondary" className="text-xs">{bm.base_model_filename || bm.base_model_name}</Text>
                      {bm.notes && <Text type="secondary" className="text-xs">备注: {bm.notes}</Text>}
                    </Space>
                    <Space>
                      <Tag color={bm.compatible ? "success" : "error"}>
                        {bm.compatible ? "兼容" : "不兼容"}
                      </Tag>
                      <Button
                        type="link"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => handleDeleteBaseModel(bm.id)}
                      >
                        删除
                      </Button>
                    </Space>
                  </div>
                ))}
              </Space>
            )}
          </Card>
        </Space>
      ),
    },
    {
      key: "trigger-words",
      label: (
        <span>
          <ThunderboltOutlined /> 触发词
        </span>
      ),
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <Form form={triggerWordForm} layout="inline">
            <Form.Item name="trigger_word" rules={[{ required: true, message: "请输入触发词" }]}>
              <Input placeholder="触发词" style={{ width: 200 }} />
            </Form.Item>
            <Form.Item name="weight" initialValue={1.0}>
              <InputNumber min={0} max={1} step={0.1} placeholder="权重" style={{ width: 100 }} />
            </Form.Item>
            <Form.Item name="is_negative" valuePropName="checked" initialValue={false}>
              <Switch checkedChildren="负向" unCheckedChildren="正向" />
            </Form.Item>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAddTriggerWord}>
              添加
            </Button>
          </Form>
          <Card size="small">
            {triggerWords.length === 0 ? (
              <Empty description="暂无触发词" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <Space direction="vertical" style={{ width: "100%" }} size="small">
                {triggerWords.map((tw) => (
                  <div key={tw.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                    <Space>
                      <Text strong>{tw.trigger_word}</Text>
                      <Tag color="orange">权重: {tw.weight}</Tag>
                      {tw.is_negative && <Tag color="red">负向</Tag>}
                    </Space>
                    <Button
                      type="link"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => handleDeleteTriggerWord(tw.id)}
                    >
                      删除
                    </Button>
                  </div>
                ))}
              </Space>
            )}
          </Card>
        </Space>
      ),
    },
    {
      key: "group",
      label: (
        <span>
          <RocketOutlined /> 版本管理
        </span>
      ),
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size="large">
          <Card size="small">
            <Form form={versionForm} layout="vertical" initialValues={{ group_id: (selected as any)?.group_id }}>
              <Form.Item label="版本标签" name="version_tag">
                <Input placeholder="如: low, high, v1, v2" />
              </Form.Item>
              <Form.Item label="所属组" name="group_id">
                <Select
                  placeholder="选择 LoRA 组"
                  allowClear
                  options={groups.map((g) => ({
                    label: `${g.display_name || g.group_name} (${g.lora_count} 个 LoRA)`,
                    value: g.id,
                  }))}
                />
              </Form.Item>
              <Button type="primary" icon={<CheckCircleOutlined />} onClick={handleUpdateVersion} block>
                更新版本信息
              </Button>
            </Form>
          </Card>

          {(selected as any)?.group_id && groupLoras.length > 0 && (
            <Card size="small" title="组内其他版本">
              <Space direction="vertical" style={{ width: "100%" }} size="small">
                {groupLoras.map((l) => (
                  <div
                    key={l.id}
                    className="flex items-center justify-between p-2 bg-gray-50 rounded cursor-pointer hover:bg-blue-50"
                    onClick={() => setSelected(l)}
                  >
                    <Space direction="vertical" size="small">
                      <Text strong={selected ? l.id === selected.id : false}>{l.display_name || l.lora_name}</Text>
                      <Space>
                        {(l as any).version_tag && <Tag color="purple">{(l as any).version_tag}</Tag>}
                        {selected && l.id === selected.id && <Tag color="blue">当前</Tag>}
                      </Space>
                    </Space>
                  </div>
                ))}
              </Space>
            </Card>
          )}

          <Card size="small" bordered={false} style={{ backgroundColor: "#e6f7ff" }}>
            <Space direction="vertical" size="small">
              <Title level={5} style={{ margin: 0 }}>💡 使用说明</Title>
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                <li><strong>版本标签</strong>：用于区分同一功能的不同版本（如 low/high 轻重版本）</li>
                <li><strong>LoRA 组</strong>：将相关的 LoRA 组织在一起（如同一系列的不同版本）</li>
                <li>设置组后，可以在"组内其他版本"中快速切换查看同一组的其他 LoRA</li>
              </ul>
            </Space>
          </Card>
        </Space>
      ),
    },
  ];

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <Title level={2} style={{ margin: 0 }}>LoRA 管理</Title>
        <Button
          type="primary"
          icon={<ScanOutlined />}
          onClick={handleScan}
          loading={scanning}
          size="large"
        >
          扫描文件夹
        </Button>
      </div>

      <div className="flex gap-6">
        {/* 左侧：LoRA 列表 */}
        <div className="flex-1">
          <Card>
            <Space style={{ marginBottom: 16 }} className="w-full">
              <Search
                placeholder="搜索 LoRA..."
                allowClear
                onSearch={(value) => setSearchText(value)}
                onChange={(e) => e.target.value ? setSearchText(e.target.value) : null}
                style={{ width: "100%" }}
              />
            </Space>
            <Table
              rowKey="id"
              columns={columns}
              dataSource={list}
              pagination={{ pageSize: 10 }}
              scroll={{ y: 600 }}
              onRow={(record) => ({
                onClick: () => setSelected(record),
                style: {
                  cursor: "pointer",
                  backgroundColor: selected?.id === record.id ? "#e6f7ff" : undefined,
                },
              })}
            />
          </Card>
        </div>

        {/* 右侧：详情面板 */}
        <div style={{ width: 500, position: "sticky", top: 24 }}>
          <Card
            title={selected ? "LoRA 详情" : "请选择一个 LoRA"}
            extra={selected && (
              <Button
                type="link"
                onClick={() => {
                  setEditingLora(selected);
                  form.setFieldsValue(selected);
                  setModalVisible(true);
                }}
              >
                编辑
              </Button>
            )}
          >
            {selected ? (
              <>
                <Descriptions column={1} size="small" bordered>
                  <Descriptions.Item label="显示名称">
                    {selected.display_name || "-"}
                  </Descriptions.Item>
                  <Descriptions.Item label="文件名">
                    <Tooltip title={selected.lora_name}>
                      <span className="font-mono text-xs break-all">{selected.lora_name}</span>
                    </Tooltip>
                  </Descriptions.Item>
                  <Descriptions.Item label="版本标签">
                    {(selected as any).version_tag ? (
                      <Tag color="purple">{(selected as any).version_tag}</Tag>
                    ) : "-"}
                  </Descriptions.Item>
                  <Descriptions.Item label="所属组">
                    {(selected as any).group_id ? (
                      <Tag color="blue">
                        {groups.find((g) => g.id === (selected as any).group_id)?.display_name ||
                         groups.find((g) => g.id === (selected as any).group_id)?.group_name}
                      </Tag>
                    ) : "-"}
                  </Descriptions.Item>
                  <Descriptions.Item label="描述">
                    {selected.description || "-"}
                  </Descriptions.Item>
                  <Descriptions.Item label="优先级">
                    {selected.priority}
                  </Descriptions.Item>
                </Descriptions>

                <Divider />

                <Tabs items={tabItems} />
              </>
            ) : (
              <Empty
                description="请选择一个 LoRA 查看详情"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            )}
          </Card>
        </div>
      </div>

      {/* 编辑模态框 */}
      <Modal
        title={editingLora ? "编辑 LoRA" : "添加 LoRA"}
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          setEditingLora(null);
          form.resetFields();
        }}
        footer={null}
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            try {
              if (editingLora) {
                await api.update(editingLora.id, values);
                message.success("LoRA 已更新");
              } else {
                await api.create(values);
                message.success("LoRA 已创建");
              }
              setModalVisible(false);
              setEditingLora(null);
              form.resetFields();
              loadList();
            } catch (e: any) {
              message.error(e.message);
            }
          }}
        >
          <Form.Item name="lora_name" label="文件名" rules={[{ required: true }]}>
            <Input placeholder="如: sports_better.safetensors" />
          </Form.Item>
          <Form.Item name="display_name" label="显示名称">
            <Input placeholder="如: 运动增强" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <TextArea rows={3} placeholder="功能描述" />
          </Form.Item>
          <Form.Item name="priority" label="优先级" initialValue={0}>
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="enabled" label="状态" valuePropName="checked" initialValue>
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block>
              {editingLora ? "保存" : "创建"}
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
