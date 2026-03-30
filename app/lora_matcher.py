"""
LoRA 匹配模块
根据用户提示词和基模信息，智能匹配合适的 LoRA
"""

import time
import jieba
from typing import List, Dict, Any, Optional

from app import lora_manager as lm
from app.db import fetchall


def match_loras(
    user_prompt: str,
    base_model: Optional[str] = None,
    checkpoint: Optional[str] = None,
    limit: int = 10,
    min_score: float = 0.0
) -> Dict[str, Any]:
    """
    匹配合适的 LoRA

    Args:
        user_prompt: 用户提示词
        base_model: 基模名称（如 "SD 1.5", "SDXL"）
        checkpoint: 基模文件名（如 "v1-5-pruned.safetensors"）
        limit: 返回数量限制
        min_score: 最低匹配分数

    Returns:
        {
            "matched_loras": [...],
            "total_count": int,
            "execution_time_ms": float
        }
    """
    start_time = time.time()

    # 1. 分词
    words = jieba.lcut(user_prompt)
    word_set = set(words)

    # 2. 查找启用的 LoRA 及其关键词
    sql = """
        SELECT
            l.id,
            l.lora_name,
            l.display_name,
            l.description,
            l.priority,
            l.file_size,
            l.civitai_preview_url,
            lk.keyword,
            lk.weight as keyword_weight
        FROM loras l
        LEFT JOIN lora_keywords lk ON l.id = lk.lora_id
        WHERE l.enabled = TRUE
        AND lk.keyword IS NOT NULL
    """
    all_keywords = fetchall(sql)

    # 3. 按关键词分组
    lora_keywords_map: Dict[int, List[Dict[str, Any]]] = {}
    for row in all_keywords:
        lora_id = row["id"]
        if lora_id not in lora_keywords_map:
            lora_keywords_map[lora_id] = []
        lora_keywords_map[lora_id].append({
            "keyword": row["keyword"],
            "weight": float(row["keyword_weight"]) if row["keyword_weight"] else 1.0
        })

    # 4. 精确匹配：keyword in user_prompt
    matched_loras = []
    for lora_id, keywords in lora_keywords_map.items():
        matched_keywords = []
        keyword_weights = []

        for kw in keywords:
            keyword = kw["keyword"]
            # 精确匹配：关键词完整出现在用户提示词中
            if keyword in user_prompt:
                matched_keywords.append(keyword)
                keyword_weights.append(kw["weight"])

        if not matched_keywords:
            continue

        # 5. 基模过滤
        if base_model or checkpoint:
            base_model_sql = """
                SELECT compatible, base_model_name, base_model_filename
                FROM lora_base_models
                WHERE lora_id = %s
            """
            if base_model:
                base_model_sql += f" AND base_model_name = '{base_model}'"
            if checkpoint:
                base_model_sql += f" AND base_model_filename = '{checkpoint}'"

            base_models = fetchall(base_model_sql, (lora_id,))

            # 如果配置了基模限制，但没有匹配的基模，跳过
            if base_model or checkpoint:
                if not base_models:
                    continue
                # 检查是否兼容
                if all(not bm["compatible"] for bm in base_models):
                    continue
                # 使用第一个兼容基模的名称
                base_model_name = base_models[0]["base_model_name"] or base_model or checkpoint
            else:
                base_model_name = base_model or checkpoint or "Unknown"
        else:
            base_model_name = "Any"

        # 6. 计算匹配分数
        base_score = len(matched_keywords) * 0.3
        weight_bonus = sum(keyword_weights) / len(keyword_weights) * 0.2 if keyword_weights else 0
        coverage_bonus = (len(matched_keywords) / len(keywords)) * 0.3

        # 获取优先级
        lora_info = lm.get_lora(lora_id)
        priority = lora_info["priority"] if lora_info else 0
        priority_bonus = min(priority * 0.01, 1.0)

        total_score = min(base_score + weight_bonus + priority_bonus + coverage_bonus, 1.0)

        if total_score < min_score:
            continue

        # 7. 获取触发词
        trigger_words_data = lm.get_lora_trigger_words(lora_id)
        trigger_words = [tw["trigger_word"] for tw in trigger_words_data if not tw["is_negative"]]
        trigger_weights = [float(tw["weight"]) for tw in trigger_words_data if not tw["is_negative"]]

        matched_loras.append({
            "lora_id": lora_id,
            "lora_name": lora_info["lora_name"] if lora_info else "",
            "display_name": lora_info["display_name"] if lora_info else None,
            "description": lora_info["description"] if lora_info else None,
            "trigger_words": trigger_words,
            "trigger_weights": trigger_weights,
            "matched_keywords": matched_keywords,
            "match_score": round(total_score, 4),
            "base_model": base_model_name,
            "priority": priority,
            "file_size": lora_info["file_size"] if lora_info else 0,
            "civitai_preview_url": lora_info["civitai_preview_url"] if lora_info else None
        })

    # 8. 排序：按分数降序，优先级降序
    matched_loras.sort(key=lambda x: (x["match_score"], x["priority"]), reverse=True)

    # 9. 限制返回数量
    result = matched_loras[:limit]

    execution_time = (time.time() - start_time) * 1000  # 转换为毫秒

    return {
        "matched_loras": result,
        "total_count": len(result),
        "execution_time_ms": round(execution_time, 2)
    }


def ensure_jieba_installed():
    """确保 jieba 已安装"""
    try:
        import jieba
        return True
    except ImportError:
        print("[lora_matcher] jieba 未安装，请运行: pip install jieba")
        return False
