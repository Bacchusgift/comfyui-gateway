-- LoRA 管理系统数据库表结构
-- 创建时间: 2026-03-30
-- 说明: 用于 LoRA 管理和智能匹配系统

-- ==================== LoRA 主表 ====================
CREATE TABLE IF NOT EXISTS loras (
    id INT AUTO_INCREMENT PRIMARY KEY,
    lora_name VARCHAR(255) NOT NULL UNIQUE COMMENT 'LoRA 文件名或唯一标识',
    display_name VARCHAR(255) DEFAULT NULL COMMENT '显示名称',
    description TEXT DEFAULT NULL COMMENT '功能描述',
    priority INT DEFAULT 0 COMMENT '优先级，用于排序',
    enabled BOOLEAN DEFAULT TRUE COMMENT '是否启用',
    file_size BIGINT DEFAULT 0 COMMENT '文件大小（字节）',
    civitai_model_id VARCHAR(64) DEFAULT NULL COMMENT 'Civitai 模型 ID',
    civitai_version_id VARCHAR(64) DEFAULT NULL COMMENT 'Civitai 版本 ID',
    civitai_preview_url VARCHAR(512) DEFAULT NULL COMMENT 'Civitai 预览图 URL',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_enabled (enabled),
    INDEX idx_priority (priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='LoRA 主表';

-- ==================== LoRA 用户关键词表 ====================
CREATE TABLE IF NOT EXISTS lora_keywords (
    id INT AUTO_INCREMENT PRIMARY KEY,
    lora_id INT NOT NULL,
    keyword VARCHAR(128) NOT NULL COMMENT '用户关键词',
    weight DECIMAL(3,2) DEFAULT 1.00 COMMENT '权重，用于匹配度计算',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lora_id) REFERENCES loras(id) ON DELETE CASCADE,
    INDEX idx_lora_id (lora_id),
    INDEX idx_keyword (keyword)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='LoRA 用户关键词表';

-- ==================== LoRA 基模关联表（多对多）====================
CREATE TABLE IF NOT EXISTS lora_base_models (
    id INT AUTO_INCREMENT PRIMARY KEY,
    lora_id INT NOT NULL,
    base_model_name VARCHAR(128) DEFAULT NULL COMMENT '基模名称，如 SD 1.5, SDXL',
    base_model_filename VARCHAR(255) DEFAULT NULL COMMENT '基模文件名',
    compatible BOOLEAN DEFAULT TRUE COMMENT '是否兼容',
    notes TEXT DEFAULT NULL COMMENT '备注',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lora_id) REFERENCES loras(id) ON DELETE CASCADE,
    INDEX idx_lora_id (lora_id),
    INDEX idx_base_model_name (base_model_name),
    INDEX idx_base_model_filename (base_model_filename)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='LoRA 基模关联表';

-- ==================== LoRA 触发词表 ====================
CREATE TABLE IF NOT EXISTS lora_trigger_words (
    id INT AUTO_INCREMENT PRIMARY KEY,
    lora_id INT NOT NULL,
    trigger_word VARCHAR(255) NOT NULL COMMENT '触发词',
    weight DECIMAL(3,2) DEFAULT 1.00 COMMENT '权重',
    is_negative BOOLEAN DEFAULT FALSE COMMENT '是否为负向触发词',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lora_id) REFERENCES loras(id) ON DELETE CASCADE,
    INDEX idx_lora_id (lora_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='LoRA 触发词表';

-- ==================== 示例数据（可选）====================
-- 插入示例 LoRA
INSERT INTO loras (lora_name, display_name, description, priority, enabled) VALUES
('sports_better.safetensors', '运动增强', '优化运动场景的 LoRA，特别适合人物动作和运动器材', 10, TRUE),
('anime_style.safetensors', '动漫风格', '将写实图片转换为动漫风格', 5, TRUE);

-- 插入示例关键词
INSERT INTO lora_keywords (lora_id, keyword, weight) VALUES
(1, '打球', 1.0),
(1, '运动', 0.9),
(1, '篮球', 1.0),
(1, '足球', 1.0),
(2, '动漫', 1.0),
(2, '卡通', 0.8),
(2, '二次元', 0.9);

-- 插入示例基模关联
INSERT INTO lora_base_models (lora_id, base_model_name, base_model_filename, compatible, notes) VALUES
(1, 'SD 1.5', 'v1-5-pruned.safetensors', TRUE, '完全兼容'),
(1, 'SDXL', NULL, FALSE, '不兼容 SDXL'),
(2, 'SD 1.5', NULL, TRUE, '兼容所有 SD 1.5 系列'),
(2, 'SDXL', 'sd_xl_base_1.0.safetensors', TRUE, '也支持 SDXL');

-- 插入示例触发词
INSERT INTO lora_trigger_words (lora_id, trigger_word, weight, is_negative) VALUES
(1, 'PLAY BASKETBALL', 1.0, FALSE),
(1, 'sports', 0.8, FALSE),
(1, 'action shot', 0.9, FALSE),
(2, 'anime style', 1.0, FALSE),
(2, 'manga', 0.9, FALSE),
(2, 'cell shading', 0.8, FALSE);

-- 查询验证
SELECT '=== LoRA 列表 ===' AS info;
SELECT id, lora_name, display_name, priority, enabled FROM loras;

SELECT '=== 关键词数量 ===' AS info;
SELECT lora_id, COUNT(*) as keyword_count FROM lora_keywords GROUP BY lora_id;

SELECT '=== 基模关联 ===' AS info;
SELECT l.lora_name, lbm.base_model_name, lbm.compatible
FROM lora_base_models lbm
JOIN loras l ON lbm.lora_id = l.id;

SELECT '=== 触发词 ===' AS info;
SELECT l.lora_name, ltw.trigger_word, ltw.weight
FROM lora_trigger_words ltw
JOIN loras l ON ltw.lora_id = l.id;
