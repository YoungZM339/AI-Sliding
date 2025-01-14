// 在文件开头添加OpenAI API配置
const OPENAI_API_KEY = 'your-api-key-here';
const OPENAI_API_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

class PopupManager {
    constructor() {
        this.translatePopup = null;
        this.actionMenu = null;
        this.isInitialized = false;
        this.lastSelectedText = '';
        this.lastRange = null;

        // 确保DOM加载完成后再初始化
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            this.init();
        }
    }

    init() {
        if (this.isInitialized) return;
        console.log('初始化 PopupManager...');

        // 创建翻译弹窗
        this.translatePopup = document.createElement('div');
        this.translatePopup.id = 'translate-popup';
        this.translatePopup.style.display = 'none';

        // 创建操作菜单
        this.actionMenu = document.createElement('div');
        this.actionMenu.id = 'action-menu';
        this.actionMenu.style.display = 'none';

        // 添加到页面
        document.body.appendChild(this.translatePopup);
        document.body.appendChild(this.actionMenu);

        // 初始化marked配置
        if (typeof marked !== 'undefined') {
            marked.setOptions({
                breaks: true,
                gfm: true,
                sanitize: false
            });
        }

        // 绑定事件
        this.bindEvents();
        this.isInitialized = true;
        console.log('PopupManager 初始化完成');
    }

    bindEvents() {
        console.log('绑定事件处理程序...');

        // 处理选中文本
        document.addEventListener('mouseup', (e) => {
            // 忽略来自弹窗和菜单的事件
            if (e.target.closest('#translate-popup') || e.target.closest('#action-menu')) {
                return;
            }

            console.log('触发 mouseup 事件');
            this.handleSelection(e);
        });

        // 处理点击其他区域关闭弹窗
        document.addEventListener('mousedown', (e) => {
            console.log('触发 mousedown 事件');
            // 检查点击是否在弹窗或菜单之外
            const isClickOutsidePopup = this.translatePopup && !this.translatePopup.contains(e.target);
            const isClickOutsideMenu = this.actionMenu && !this.actionMenu.contains(e.target);
            const isClickOnActionItem = e.target.closest('.action-item');

            if (isClickOutsidePopup && isClickOutsideMenu && !isClickOnActionItem) {
                this.hideAll();
            }
        });

        // 处理ESC键关闭弹窗
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideAll();
            }
        });

        // 处理页面滚动时更新弹窗位置
        window.addEventListener('scroll', () => {
            if (this.translatePopup.style.display !== 'none' && this.lastRange) {
                const rect = this.lastRange.getBoundingClientRect();
                const pos = this.calculatePosition(rect.left, rect.bottom, {
                    width: this.translatePopup.offsetWidth,
                    height: this.translatePopup.offsetHeight
                });
                this.translatePopup.style.left = pos.left + 'px';
                this.translatePopup.style.top = pos.top + 'px';
            }
        }, { passive: true });

        console.log('事件处理程序绑定完成');
    }

    handleSelection(e) {
        console.log('处理文本选择...');
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();

        console.log('选中的文本:', selectedText);

        if (!selectedText) {
            console.log('没有选中文本，隐藏所有弹窗');
            this.hideAll();
            return;
        }

        try {
            // 获取选中文本的位置
            const range = selection.getRangeAt(0);
            this.lastRange = range;
            this.lastSelectedText = selectedText;

            const rect = range.getBoundingClientRect();
            console.log('选中文本的位置:', rect);

            // 确保选中的文本不是弹窗内的内容
            if (!this.translatePopup.contains(range.commonAncestorContainer)) {
                console.log('显示操作菜单');
                this.showActionMenu(rect.left, rect.bottom);
            } else {
                console.log('选中的是弹窗内的文本，不显示菜单');
            }
        } catch (error) {
            console.error('处理选中文本时出错:', error);
        }
    }

    showActionMenu(x, y) {
        console.log('显示操作菜单:', { x, y });

        // 先清除旧的内容和事件监听器
        this.actionMenu.innerHTML = '';

        // 创建菜单项
        const translateItem = document.createElement('div');
        translateItem.className = 'action-item';
        translateItem.dataset.action = 'translate';
        translateItem.textContent = '翻译';

        const explainItem = document.createElement('div');
        explainItem.className = 'action-item';
        explainItem.dataset.action = 'explain';
        explainItem.textContent = '解释';

        // 添加菜单项到菜单
        this.actionMenu.appendChild(translateItem);
        this.actionMenu.appendChild(explainItem);

        // 定位菜单
        const menuRect = {
            width: 100,
            height: 80
        };

        const pos = this.calculatePosition(x, y, menuRect);
        console.log('计算的菜单位置:', pos);

        // 设置菜单位置和显示
        this.actionMenu.style.left = Math.max(0, pos.left) + 'px';
        this.actionMenu.style.top = Math.max(0, pos.top) + 'px';
        this.actionMenu.style.display = 'block';

        // 绑定菜单项点击事件
        const handleClick = (e) => {
            console.log('菜单项被点击');
            const actionItem = e.target.closest('.action-item');
            if (actionItem) {
                console.log('处理菜单项点击:', actionItem.dataset.action);
                e.preventDefault();
                e.stopPropagation();
                this.handleActionClick(actionItem.dataset.action);
            }
        };

        translateItem.addEventListener('click', handleClick);
        explainItem.addEventListener('click', handleClick);
    }

    async handleActionClick(action) {
        console.log('开始处理动作:', action);
        const selection = window.getSelection();
        const text = selection.toString().trim();
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        console.log('处理操作:', action, '选中文本:', text);

        // 隐藏操作菜单
        this.actionMenu.style.display = 'none';

        try {
            // 确保选中的文本还存在
            if (!text) {
                throw new Error('未找到选中的文本');
            }

            await this.showTranslatePopup(text, rect, action);
        } catch (error) {
            console.error('处理操作时出错:', error);
            // 显示错误信息给用户
            this.translatePopup.innerHTML = `
                <div class="error-message">处理请求时出错: ${error.message}</div>
            `;
            this.translatePopup.style.display = 'block';
        }
    }

    async showTranslatePopup(text, rect, action) {
        console.log('准备显示翻译弹窗:', { text, action });

        // 显示加载状态
        this.translatePopup.innerHTML = '<div class="loading">处理中...</div>';
        this.translatePopup.style.display = 'block';

        // 设置初始位置
        const initialPos = this.calculatePosition(rect.left, rect.bottom, {
            width: 300,
            height: 100
        });
        this.translatePopup.style.left = initialPos.left + 'px';
        this.translatePopup.style.top = initialPos.top + 'px';

        try {
            // 获取存储的设置
            const settings = await chrome.storage.sync.get(['targetLanguage']);
            console.log('获取到的设置:', settings);

            let result;
            console.log('准备发起API请求...');
            if (action === 'translate') {
                console.log('调用翻译API');
                result = await translateText(text, settings.targetLanguage || '中文');
            } else {
                console.log('调用解释API');
                result = await explainText(text, settings.targetLanguage || '中文');
            }
            console.log('API请求完成，结果:', result);

            if (this.translatePopup.style.display === 'none') {
                console.log('弹窗已被隐藏，停止显示结果');
                return;
            }

            // 显示结果
            this.translatePopup.innerHTML = `
                <div class="translated-text">${result}</div>
            `;
            console.log('内容已更新到弹窗');

            // 重新计算位置
            const newPos = this.calculatePosition(rect.left, rect.bottom, {
                width: this.translatePopup.offsetWidth,
                height: this.translatePopup.offsetHeight
            });

            this.translatePopup.style.left = newPos.left + 'px';
            this.translatePopup.style.top = newPos.top + 'px';
            console.log('弹窗位置已更新');

        } catch (error) {
            console.error('处理请求时出错:', error);
            this.translatePopup.innerHTML = `
                <div class="error-message">${error.message}</div>
            `;
        }
    }

    calculatePosition(x, y, elementRect) {
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;

        let left = x + scrollX;
        let top = y + scrollY;

        // 确保不会超出右边界
        if (left + elementRect.width > scrollX + viewportWidth) {
            left = scrollX + viewportWidth - elementRect.width - 20;
        }

        // 确保不会超出下边界
        if (top + elementRect.height > scrollY + viewportHeight) {
            top = top - elementRect.height - 10;
        }

        // 确保不会超出左边界
        if (left < scrollX) {
            left = scrollX + 10;
        }

        // 确保不会超出上边界
        if (top < scrollY) {
            top = scrollY + 10;
        }

        return { left, top };
    }

    hideAll() {
        console.log('隐藏所有弹窗');
        this.translatePopup.style.display = 'none';
        this.actionMenu.style.display = 'none';
        this.lastRange = null;
        this.lastSelectedText = '';
    }
}

// 创建全局实例
const popupManager = new PopupManager();

// 添加统一的设置管理函数
async function getSettings(keys = [
    'apiKey',
    'apiEndpoint',
    'model',
    'customModel',
    'targetLanguage',
    'translatePrompt',
    'explainPrompt'
]) {
    console.log('获取设置...');
    try {
        const settings = await chrome.storage.sync.get(keys);
        console.log('获取到的设置:', { ...settings, apiKey: settings.apiKey ? '已隐藏' : undefined });

        // 设置默认值
        const defaults = {
            apiEndpoint: 'https://api.openai.com/v1',
            model: 'gpt-4o-mini',
            targetLanguage: '中文',
            translatePrompt: '你是一个专业的翻译助手。请直接翻译文本，不要添加任何解释或额外内容。',
            explainPrompt: '你是一个专业的解释助手。请用简明扼要的语言解释文本的含义。'
        };

        // 合并默认值和用户设置
        return { ...defaults, ...settings };
    } catch (error) {
        console.error('获取设置时出错:', error);
        throw error;
    }
}

// 修改翻译请求部分
async function translateText(text, targetLanguage = '中文') {
    console.log('开始翻译请求...');
    try {
        const settings = await getSettings();
        
        if (!settings.apiKey) {
            throw new Error('请先在扩展选项中设置 OpenAI API Key');
        }

        const endpoint = `${settings.apiEndpoint}/chat/completions`;
        console.log('使用API端点:', endpoint);

        // 确定使用的模型
        let modelName = settings.model;
        if (modelName === 'custom' && settings.customModel) {
            modelName = settings.customModel;
        }
        console.log('使用模型:', modelName);

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${settings.apiKey}`
            },
            body: JSON.stringify({
                model: modelName,
                messages: [
                    {
                        role: "system",
                        content: settings.translatePrompt
                    },
                    {
                        role: "user",
                        content: `目标语言:${targetLanguage}\n文本内容是:\n${text}`
                    }
                ],
                temperature: 0.3
            })
        });

        console.log('API响应状态:', response.status);
        const responseData = await response.json();
        console.log('API响应数据:', responseData);

        if (!response.ok) {
            throw new Error(`翻译请求失败: ${responseData.error?.message || response.statusText}`);
        }

        return responseData.choices[0].message.content.trim();
    } catch (error) {
        console.error('翻译过程出错:', error);
        throw error;
    }
}

// 修改解释文本的函数
async function explainText(text, targetLanguage = '中文') {
    console.log('开始解释请求...');
    try {
        const settings = await getSettings();
        
        if (!settings.apiKey) {
            throw new Error('请先在扩展选项中设置 OpenAI API Key');
        }

        const endpoint = `${settings.apiEndpoint}/chat/completions`;
        console.log('使用API端点:', endpoint);

        let modelName = settings.model;
        if (modelName === 'custom' && settings.customModel) {
            modelName = settings.customModel;
        }
        console.log('使用模型:', modelName);

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${settings.apiKey}`
            },
            body: JSON.stringify({
                model: modelName,
                messages: [
                    {
                        role: "system",
                        content: settings.explainPrompt
                    },
                    {
                        role: "user",
                        content: `目标语言:${targetLanguage}\n文本内容是:\n${text}`
                    }
                ],
                temperature: 0.3
            })
        });

        console.log('API响应状态:', response.status);
        const responseData = await response.json();
        console.log('API响应数据:', responseData);

        if (!response.ok) {
            throw new Error(`解释请求失败: ${responseData.error?.message || response.statusText}`);
        }

        return responseData.choices[0].message.content.trim();
    } catch (error) {
        console.error('解释过程出错:', error);
        throw error;
    }
} 