/**
 * 草稿存储管理
 *
 * 职责：
 * - 负责每个会话的草稿内容的持久化存储
 * - 提供草稿的读取、保存、删除、批量删除和清空功能
 * - 验证草稿数据的 schema 版本
 * - 提供草稿管理器（DraftManager）用于简化草稿操作
 *
 * 依赖：
 * - constants.js（存储键名）
 * - safe-storage.js（安全的 JSON 存储操作）
 *
 * 被依赖：session-store, api-manager
 */
import { CHAT_DRAFTS_KEY } from '../constants.js';
import { safeGetJson, safeSetJson } from '../../shared/safe-storage.js';

// 草稿数据的 schema 版本号
const DRAFT_SCHEMA_VERSION = 1;

/**
 * 创建空的草稿数据对象
 * @returns {Object} 空草稿数据结构
 */
function createEmptyDrafts() {
    return {
        version: DRAFT_SCHEMA_VERSION,
        drafts: {}
    };
}

/**
 * 将值转换为修剪后的字符串
 */
function asTrimmedString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * 规范化单个草稿条目
 *
 * @param {Object} rawEntry - 原始草稿条目
 * @returns {Object|null} 规范化后的草稿条目，如果无效则返回 null
 */
function normalizeDraftEntry(rawEntry) {
    if (!rawEntry || typeof rawEntry !== 'object') {
        return null;
    }

    const text = typeof rawEntry.text === 'string' ? rawEntry.text : '';
    if (!text.trim()) {
        return null;
    }

    const updatedAt = Number.isFinite(rawEntry.updatedAt) && rawEntry.updatedAt > 0
        ? rawEntry.updatedAt
        : Date.now();

    return {
        text,
        updatedAt
    };
}

/**
 * 规范化草稿数据对象
 *
 * 验证 schema 版本，规范化所有草稿条目，确保数据结构的一致性
 *
 * @param {Object} rawPayload - 原始草稿数据
 * @returns {Object} 规范化后的草稿数据对象
 */
function normalizeDraftPayload(rawPayload) {
    if (!rawPayload || typeof rawPayload !== 'object') {
        return createEmptyDrafts();
    }

    // 版本不匹配，返回空草稿（不兼容旧版本）
    if (rawPayload.version !== DRAFT_SCHEMA_VERSION) {
        return createEmptyDrafts();
    }

    if (!rawPayload.drafts || typeof rawPayload.drafts !== 'object') {
        return createEmptyDrafts();
    }

    // 规范化所有草稿条目，过滤无效条目
    const drafts = Object.fromEntries(
        Object.entries(rawPayload.drafts)
            .map(([sessionId, entry]) => {
                const normalizedSessionId = asTrimmedString(sessionId);
                if (!normalizedSessionId) {
                    return null;
                }

                const normalizedEntry = normalizeDraftEntry(entry);
                if (!normalizedEntry) {
                    return null;
                }

                return [normalizedSessionId, normalizedEntry];
            })
            .filter(Boolean)
    );

    return {
        version: DRAFT_SCHEMA_VERSION,
        drafts
    };
}

/**
 * 从存储加载草稿数据
 *
 * @param {Storage} storage - 存储对象（localStorage 或 sessionStorage）
 * @param {string} storageKey - 存储键名
 * @returns {Object} 规范化后的草稿数据对象
 */
export function loadDrafts(storage, storageKey = CHAT_DRAFTS_KEY) {
    const rawPayload = safeGetJson(storageKey, createEmptyDrafts(), storage);
    return normalizeDraftPayload(rawPayload);
}

/**
 * 保存草稿数据到存储
 *
 * @param {Storage} storage - 存储对象（localStorage 或 sessionStorage）
 * @param {string} storageKey - 存储键名
 * @param {Object} payload - 草稿数据对象
 * @returns {boolean} 是否保存成功
 */
export function saveDrafts(storage, storageKey = CHAT_DRAFTS_KEY, payload = createEmptyDrafts()) {
    return safeSetJson(storageKey, normalizeDraftPayload(payload), storage);
}

/**
 * 获取指定会话的草稿内容
 *
 * @param {Object} payload - 草稿数据对象
 * @param {string} sessionId - 会话 ID
 * @returns {string} 草稿文本，如果不存在则返回空字符串
 */
export function getDraft(payload, sessionId) {
    const normalizedPayload = normalizeDraftPayload(payload);
    const normalizedSessionId = asTrimmedString(sessionId);
    if (!normalizedSessionId) {
        return '';
    }

    return normalizedPayload.drafts[normalizedSessionId]?.text || '';
}

/**
 * 设置指定会话的草稿内容
 *
 * 如果文本为空，则删除该会话的草稿
 *
 * @param {Object} payload - 草稿数据对象
 * @param {string} sessionId - 会话 ID
 * @param {string} text - 草稿文本
 * @param {number} updatedAt - 更新时间戳
 * @returns {Object} 更新后的草稿数据对象
 */
export function setDraft(payload, sessionId, text, updatedAt = Date.now()) {
    const normalizedPayload = normalizeDraftPayload(payload);
    const normalizedSessionId = asTrimmedString(sessionId);
    if (!normalizedSessionId) {
        return normalizedPayload;
    }

    const nextPayload = {
        ...normalizedPayload,
        drafts: { ...normalizedPayload.drafts }
    };

    // 如果文本为空，删除该会话的草稿
    if (typeof text !== 'string' || !text.trim()) {
        delete nextPayload.drafts[normalizedSessionId];
        return nextPayload;
    }

    // 保存草稿
    nextPayload.drafts[normalizedSessionId] = {
        text,
        updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now()
    };

    return nextPayload;
}

/**
 * 删除指定会话的草稿
 *
 * @param {Object} payload - 草稿数据对象
 * @param {string} sessionId - 会话 ID
 * @returns {Object} 更新后的草稿数据对象
 */
export function removeDraft(payload, sessionId) {
    return setDraft(payload, sessionId, '');
}

/**
 * 清空所有草稿
 * @returns {Object} 空草稿数据对象
 */
export function clearAllDrafts() {
    return createEmptyDrafts();
}

/**
 * 创建草稿管理器
 *
 * 提供简化的草稿操作接口，自动处理持久化
 *
 * @param {Object} options - 配置选项
 * @param {Storage} options.storage - 存储对象（localStorage 或 sessionStorage）
 * @param {string} options.storageKey - 存储键名
 * @param {Function} options.now - 获取当前时间戳的函数（用于测试）
 * @returns {Object} 草稿管理器对象
 */
export function createDraftManager({
    storage = null,
    storageKey = CHAT_DRAFTS_KEY,
    now = () => Date.now()
} = {}) {
    let payload = loadDrafts(storage, storageKey);

    // 持久化草稿数据到存储
    function persist() {
        saveDrafts(storage, storageKey, payload);
    }

    // 获取指定会话的草稿
    function getDraftBySession(sessionId) {
        return getDraft(payload, sessionId);
    }

    // 设置指定会话的草稿（自动持久化）
    function setDraftBySession(sessionId, text) {
        payload = setDraft(payload, sessionId, text, now());
        persist();
    }

    // 删除指定会话的草稿（自动持久化）
    function removeDraftBySession(sessionId) {
        payload = removeDraft(payload, sessionId);
        persist();
    }

    // 清空所有草稿（自动持久化）
    function clearAll() {
        payload = clearAllDrafts();
        persist();
    }

    // 批量删除多个会话的草稿（自动持久化）
    function removeMany(sessionIds) {
        if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
            return;
        }

        let nextPayload = payload;
        sessionIds.forEach((sessionId) => {
            nextPayload = removeDraft(nextPayload, sessionId);
        });
        payload = nextPayload;
        persist();
    }

    // 获取当前草稿数据的快照
    function getSnapshot() {
        return payload;
    }

    return {
        getDraft: getDraftBySession,
        setDraft: setDraftBySession,
        removeDraft: removeDraftBySession,
        removeMany,
        clearAllDrafts: clearAll,
        getSnapshot
    };
}

