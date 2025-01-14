document.addEventListener('DOMContentLoaded', function() {
  const apiKeyInput = document.getElementById('apiKey');
  const apiEndpointInput = document.getElementById('apiEndpoint');
  const modelSelect = document.getElementById('model');
  const customModelDiv = document.getElementById('customModel');
  const customModelInput = document.getElementById('customModelInput');
  const targetLanguageSelect = document.getElementById('targetLanguage');
  const translatePromptInput = document.getElementById('translatePrompt');
  const explainPromptInput = document.getElementById('explainPrompt');
  const statusMessage = document.getElementById('statusMessage');

  // 加载保存的设置
  try {
    chrome.storage.sync.get([
      'apiKey', 
      'apiEndpoint', 
      'model', 
      'customModel', 
      'targetLanguage',
      'translatePrompt',
      'explainPrompt'
    ], function(result) {
      if (chrome.runtime.lastError) {
        console.error('设置加载失败:', chrome.runtime.lastError);
        return;
      }

      if (result.apiKey) {
        apiKeyInput.value = result.apiKey;
      }
      if (result.apiEndpoint) {
        apiEndpointInput.value = result.apiEndpoint;
      } else {
        apiEndpointInput.value = 'https://api.openai.com/v1';
      }
      if (result.model) {
        modelSelect.value = result.model;
        if (result.model === 'custom') {
          customModelDiv.style.display = 'grid';
          if (result.customModel) {
            customModelInput.value = result.customModel;
          }
        }
      }
      if (result.targetLanguage) {
        targetLanguageSelect.value = result.targetLanguage;
      }
      if (result.translatePrompt) {
        translatePromptInput.value = result.translatePrompt;
      } else {
        translatePromptInput.value = '你是一个专业的翻译助手。请直接翻译文本，不要添加任何解释或额外内容。';
      }
      if (result.explainPrompt) {
        explainPromptInput.value = result.explainPrompt;
      } else {
        explainPromptInput.value = '你是一个专业的解释助手。请用简明扼要的语言解释文本的含义。';
      }
    });
  } catch (error) {
    console.error('初始化设置时出错:', error);
  }

  // 处理模型选择
  modelSelect.addEventListener('change', function() {
    try {
      const isCustom = this.value === 'custom';
      customModelDiv.style.display = isCustom ? 'grid' : 'none';
      
      if (isCustom && !customModelInput.value) {
        customModelInput.focus();
      }

      const settings = { 
        model: this.value
      };
      
      if (isCustom) {
        settings.customModel = customModelInput.value.trim();
      }
      
      chrome.storage.sync.set(settings, function() {
        if (chrome.runtime.lastError) {
          console.error('保存模型设置失败:', chrome.runtime.lastError);
          return;
        }
        showStatus('模型设置已保存');
      });
    } catch (error) {
      console.error('更改模型设置时出错:', error);
    }
  });

  // 处理自定义模型输入
  let customModelTimeout;
  customModelInput.addEventListener('input', function() {
    try {
      clearTimeout(customModelTimeout);
      const value = this.value.trim();
      
      customModelTimeout = setTimeout(() => {
        if (value && modelSelect.value === 'custom') {
          chrome.storage.sync.set({ customModel: value }, function() {
            if (chrome.runtime.lastError) {
              console.error('保存自定义模型失败:', chrome.runtime.lastError);
              return;
            }
            showStatus('自定义模型已保存');
          });
        }
      }, 500);
    } catch (error) {
      console.error('保存自定义模型时出错:', error);
    }
  });

  // 保存 API 设置
  apiKeyInput.addEventListener('change', function() {
    try {
      chrome.storage.sync.set({ apiKey: this.value.trim() }, function() {
        if (chrome.runtime.lastError) {
          console.error('保存 API Key 失败:', chrome.runtime.lastError);
          return;
        }
        showStatus('API Key 已保存');
      });
    } catch (error) {
      console.error('保存 API Key 时出错:', error);
    }
  });

  apiEndpointInput.addEventListener('change', function() {
    try {
      chrome.storage.sync.set({ apiEndpoint: this.value.trim() }, function() {
        if (chrome.runtime.lastError) {
          console.error('保存 API 端点失败:', chrome.runtime.lastError);
          return;
        }
        showStatus('API 端点已保存');
      });
    } catch (error) {
      console.error('保存 API 端点时出错:', error);
    }
  });

  // 保存目标语言设置
  targetLanguageSelect.addEventListener('change', function() {
    try {
      chrome.storage.sync.set({ targetLanguage: this.value }, function() {
        if (chrome.runtime.lastError) {
          console.error('保存目标语言失败:', chrome.runtime.lastError);
          return;
        }
        showStatus('目标语言已保存');
      });
    } catch (error) {
      console.error('保存目标语言时出错:', error);
    }
  });

  // 保存提示词设置
  translatePromptInput.addEventListener('change', function() {
    try {
      chrome.storage.sync.set({ translatePrompt: this.value.trim() }, function() {
        if (chrome.runtime.lastError) {
          console.error('保存翻译提示词失败:', chrome.runtime.lastError);
          return;
        }
        showStatus('翻译提示词已保存');
      });
    } catch (error) {
      console.error('保存翻译提示词时出错:', error);
    }
  });

  explainPromptInput.addEventListener('change', function() {
    try {
      chrome.storage.sync.set({ explainPrompt: this.value.trim() }, function() {
        if (chrome.runtime.lastError) {
          console.error('保存解释提示词失败:', chrome.runtime.lastError);
          return;
        }
        showStatus('解释提示词已保存');
      });
    } catch (error) {
      console.error('保存解释提示词时出错:', error);
    }
  });

  // 显示状态消息
  function showStatus(message) {
    statusMessage.textContent = message;
    setTimeout(() => {
      statusMessage.textContent = '';
    }, 2000);
  }
}); 