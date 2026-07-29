/**
 * Aperture Lab · AI 图片润色工具 — 编辑器改版
 * 流程：首页选择功能 → 上传原图 → 跳转编辑器 → 输入需求 → AI生成 → 历史记录
 * 状态：idle / processing / success / error
 *
 * AI 服务配置：
 * - 默认使用本地 Canvas 模拟（demo 模式）
 * - 修改 CONFIG.API.endpoint 并设置 useApi = true 即可对接真实后端
 * - 后端接口需支持：POST multipart/form-data { image, prompt } → 返回 { imageUrl }
 */

(function () {
    'use strict';

    // ============================================================
    //  全局配置（部署时修改此处即可对接真实 API）
    // ============================================================
    var CONFIG = {
        API: {
            // 是否启用真实 API（false = 本地 Canvas 模拟，用于演示）
            useApi: false,
            // 后端接口地址（部署时改为你的服务器地址，如：https://api.yourdomain.com/v1/enhance）
            endpoint: '/api/v1/image/enhance',
            // 请求超时时间（毫秒）
            timeout: 30000,
            // 鉴权 token（如需要，部署时填入）
            token: ''
        },
        FILE: {
            maxSize: 10 * 1024 * 1024,
            allowedTypes: ['image/jpeg', 'image/png', 'image/webp']
        }
    };

    // ============================================================
    //  状态常量
    // ============================================================
    var STATE = {
        IDLE: 'idle',
        PROCESSING: 'processing',
        SUCCESS: 'success',
        ERROR: 'error'
    };

    // ============================================================
    //  DOM 引用
    // ============================================================
    // 视图
    var homeView       = document.getElementById('homeView');
    var editorView     = document.getElementById('editorView');

    // 导航 & 分类
    var topnavLinks    = document.querySelectorAll('.topnav-link');
    var catPanels      = document.querySelectorAll('.cat-panel');
    var featureCards   = document.querySelectorAll('.feature-card');
    var templateItems  = document.querySelectorAll('.template-item');

    // 上传区
    var dropzone       = document.getElementById('dropzone');
    var fileInput      = document.getElementById('fileInput');
    var dropzoneEmpty  = document.getElementById('dropzoneEmpty');
    var dropzonePreview= document.getElementById('dropzonePreview');
    var previewImg     = document.getElementById('previewImg');
    var dzpName        = document.getElementById('dzpName');
    var dzpSize        = document.getElementById('dzpSize');
    var removeBtn      = document.getElementById('removeBtn');
    var browseLink     = document.getElementById('browseLink');

    // 编辑器
    var backBtn        = document.getElementById('backBtn');
    var editorFeatureName = document.getElementById('editorFeatureName');
    var editorOriginalImg = document.getElementById('editorOriginalImg');
    var editorResultImg   = document.getElementById('editorResultImg');
    var resultEmpty    = document.getElementById('resultEmpty');
    var resultLoading  = document.getElementById('resultLoading');
    var promptInput    = document.getElementById('promptInput');
    var constraintTags = document.getElementById('constraintTags');
    var generateBtn    = document.getElementById('generateBtn');
    var reuploadBtn    = document.getElementById('reuploadBtn');
    var editorHelpBtn  = document.getElementById('editorHelpBtn');

    // 历史记录
    var historyList    = document.getElementById('historyList');
    var homeHistoryList = document.getElementById('homeHistoryList');
    var homeHistoryBadge = document.getElementById('homeHistoryBadge');

    // 弹窗 & 提示
    var helpBtn        = document.getElementById('helpBtn');
    var loginBtn       = document.getElementById('loginBtn');
    var modalOverlay   = document.getElementById('modalOverlay');
    var modal          = document.getElementById('modal');
    var modalClose     = document.getElementById('modalClose');
    var toastStack     = document.getElementById('toastStack');

    // AI 对话
    var aiChat         = document.getElementById('aiChat');
    var chatToggle     = document.getElementById('chatToggle');
    var chatMessages   = document.getElementById('chatMessages');
    var chatQuick      = document.getElementById('chatQuick');
    var chatInput      = document.getElementById('chatInput');
    var chatSend       = document.getElementById('chatSend');

    // ============================================================
    //  内部状态
    // ============================================================
    var currentFile = null;
    var currentFeature = '照片增强';
    var currentCat = 'enhance';
    var currentState = STATE.IDLE;
    var originalDataUrl = '';
    var enhancedDataUrl = '';
    var historyRecords = [];
    var MAX_FILE_SIZE = CONFIG.FILE.maxSize;
    var ALLOWED_TYPES = CONFIG.FILE.allowedTypes;

    // AI 处理阶段文案
    var PROC_STEPS = [
        { text: '解析画面结构…', weight: 18 },
        { text: '识别主体与边缘…', weight: 24 },
        { text: 'AI 重构色彩与光线…', weight: 28 },
        { text: '锐化细节与降噪…', weight: 18 },
        { text: '最后润色…', weight: 12 }
    ];

    // AI 对话关键词 → 回复映射
    var CHAT_RULES = [
        { keywords: ['发灰', '灰', '不通透'], reply: '照片发灰通常是对比度和饱和度不足。建议在编辑器中描述「提升对比度、增加通透感」，AI 会自动提亮并增加色彩层次。' },
        { keywords: ['老照片', '模糊', '修复', '清晰'], reply: '老照片修复请在编辑器中描述「修复老照片划痕、还原色彩、提升清晰度」，AI 会智能去除划痕并提升画质。' },
        { keywords: ['证件照', '换底', '底色', '背景'], reply: '证件照换底请在编辑器中描述「将背景换成白色/蓝色/红色，保持人物主体不变」。' },
        { keywords: ['商品', '提亮', '电商', '店铺'], reply: '商品图提亮请在编辑器中描述「提升商品亮度、去除灰暗、增强质感」，AI 会智能识别商品主体并优化。' },
        { keywords: ['人像', '磨皮', '美颜', '肤色'], reply: '人像美化请在编辑器中描述「智能磨皮、提亮肤色、保留五官细节」，AI 会自然美化人像。' },
        { keywords: ['胶片', '复古', '港风'], reply: '胶片质感请在编辑器中描述「添加胶片颗粒感、暖色调、复古氛围」，一键搞定胶片风格。' },
        { keywords: ['抠图', '去背景', '透明'], reply: '智能抠图请在编辑器中描述「去除背景、保留主体、背景透明」，AI 会自动识别主体。' },
        { keywords: ['移除', '删除', '路人', '杂物'], reply: '移除物体请在编辑器中描述「移除画面中的路人/杂物，自动填补背景」，AI 会智能修复。' },
        { keywords: ['放大', '无损', '4k'], reply: '无损放大请在编辑器中描述「无损放大至 4K、保留细节、增强锐度」，AI 超分辨率算法可在放大的同时保留细节。' },
        { keywords: ['卡通', '动漫', '趣味'], reply: '照片卡通化请在编辑器中描述「将照片转换为卡通/动漫风格」，一键生成趣味风格。' },
        { keywords: ['怎么用', '如何', '教程', '帮助'], reply: '使用很简单：1. 在首页选择修图功能 → 2. 上传图片 → 3. 在编辑器中描述修改需求 → 4. 点击「生成结果」→ 5. 查看历史记录可下载任意版本。也可以点击右上角问号查看详细说明。' },
        { keywords: ['你好', 'hi', 'hello', '在吗'], reply: '你好！我是 AI 修图助手。告诉我你想修什么类型的图，我帮你推荐最合适的处理方式。你也可以点击下方的快捷问题快速了解。' }
    ];

    // ============================================================
    //  工具函数
    // ============================================================
    function formatBytes(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    function rafDelay(fn) {
        return requestAnimationFrame(function () {
            requestAnimationFrame(fn);
        });
    }

    function formatTime(date) {
        var h = date.getHours().toString().padStart(2, '0');
        var m = date.getMinutes().toString().padStart(2, '0');
        var s = date.getSeconds().toString().padStart(2, '0');
        return h + ':' + m + ':' + s;
    }

    // ============================================================
    //  Toast 系统
    // ============================================================
    function showToast(message, type) {
        type = type || 'info';
        var toast = document.createElement('div');
        toast.className = 'toast toast-' + type;
        toast.innerHTML =
            '<span class="toast-dot"></span>' +
            '<span class="toast-text">' + message + '</span>';
        toastStack.appendChild(toast);

        rafDelay(function () { toast.classList.add('show'); });

        setTimeout(function () {
            toast.classList.remove('show');
            setTimeout(function () {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 320);
        }, 2400);
    }

    // ============================================================
    //  模态弹窗
    // ============================================================
    function openModal() {
        modalOverlay.hidden = false;
        modal.hidden = false;
        rafDelay(function () {
            modalOverlay.classList.add('show');
            modal.classList.add('show');
        });
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        modalOverlay.classList.remove('show');
        modal.classList.remove('show');
        setTimeout(function () {
            modalOverlay.hidden = true;
            modal.hidden = true;
            document.body.style.overflow = '';
        }, 280);
    }

    if (helpBtn) {
        helpBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            openModal();
        });
    }
    if (loginBtn) {
        loginBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            showToast('登录功能即将上线，敬请期待', 'info');
        });
    }
    if (editorHelpBtn) {
        editorHelpBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            openModal();
        });
    }
    modalClose.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', closeModal);
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !modal.hidden) {
            closeModal();
        }
    });

    // ============================================================
    //  分类导航切换
    // ============================================================
    topnavLinks.forEach(function (link) {
        link.addEventListener('click', function () {
            var cat = link.dataset.cat;
            if (!cat || cat === currentCat) return;

            topnavLinks.forEach(function (l) { l.classList.remove('active'); });
            link.classList.add('active');

            catPanels.forEach(function (panel) {
                panel.classList.remove('active');
                if (panel.dataset.cat === cat) {
                    panel.classList.add('active');
                }
            });

            currentCat = cat;
        });
    });

    // ============================================================
    //  功能卡片选择
    // ============================================================
    featureCards.forEach(function (card) {
        card.addEventListener('click', function () {
            if (currentState === STATE.PROCESSING) {
                showToast('处理中，请稍候', 'error');
                return;
            }

            var panel = card.closest('.cat-panel');
            if (panel) {
                panel.querySelectorAll('.feature-card').forEach(function (c) {
                    c.classList.remove('active');
                });
            }
            card.classList.add('active');

            var featureName = card.querySelector('.fc-name');
            if (featureName) {
                currentFeature = featureName.textContent;
            }

            showToast('已选择「' + currentFeature + '」· 请上传图片', 'info');

            // 滚动到上传区
            rafDelay(function () {
                var wb = document.getElementById('workbench');
                if (wb) wb.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
        });
    });

    // ============================================================
    //  模板选择
    // ============================================================
    templateItems.forEach(function (item) {
        item.addEventListener('click', function () {
            if (currentState === STATE.PROCESSING) return;

            templateItems.forEach(function (t) { t.classList.remove('active'); });
            item.classList.add('active');

            var tplName = item.querySelector('.tpl-name');
            if (tplName) {
                showToast('已应用「' + tplName.textContent + '」模板', 'info');
            }
        });
    });

    // ============================================================
    //  视图切换
    // ============================================================
    function showEditor() {
        homeView.hidden = true;
        editorView.hidden = false;
        editorView.classList.add('active');
        window.scrollTo({ top: 0, behavior: 'instant' });

        // 更新编辑器信息
        editorFeatureName.textContent = currentFeature;
        editorOriginalImg.src = originalDataUrl;

        // 重置生成结果区
        resultEmpty.hidden = false;
        editorResultImg.src = '';
        editorResultImg.hidden = true;
        resultLoading.hidden = true;
        promptInput.value = '';

        showToast('已进入编辑器 · 描述需求即可生成', 'success');
    }

    function showHome() {
        editorView.hidden = true;
        editorView.classList.remove('active');
        homeView.hidden = false;
        window.scrollTo({ top: 0, behavior: 'instant' });
    }

    backBtn.addEventListener('click', function () {
        if (currentState === STATE.PROCESSING) {
            showToast('处理中，请稍候再返回', 'error');
            return;
        }
        showHome();
    });

    // ============================================================
    //  文件校验 & 预览
    // ============================================================
    function validateFile(file) {
        if (!file) return '未选择文件';
        if (ALLOWED_TYPES.indexOf(file.type) === -1) {
            return '仅支持 JPG / PNG / WebP 格式图片';
        }
        if (file.size > MAX_FILE_SIZE) {
            return '图片过大，请选择小于 10MB 的图片';
        }
        return null;
    }

    function loadPreview(file) {
        var reader = new FileReader();
        reader.onload = function (e) {
            originalDataUrl = e.target.result;
            currentFile = file;

            // 更新首页预览
            previewImg.src = originalDataUrl;
            dzpName.textContent = file.name;
            dzpSize.textContent = formatBytes(file.size) + ' · ' + (file.type.split('/')[1] || '').toUpperCase();

            dropzoneEmpty.hidden = true;
            dropzonePreview.hidden = false;
            rafDelay(function () { dropzonePreview.classList.add('in'); });

            showToast('图片上传成功 · 正在进入编辑器', 'success');

            // 延迟跳转到编辑器
            setTimeout(function () {
                showEditor();
            }, 600);
        };
        reader.onerror = function () {
            showToast('图片读取失败，请尝试其他图片', 'error');
        };
        reader.readAsDataURL(file);
    }

    function handleFiles(files) {
        if (!files || files.length === 0) return;
        var file = files[0];
        var err = validateFile(file);
        if (err) {
            dropzone.classList.add('shake');
            setTimeout(function () { dropzone.classList.remove('shake'); }, 420);
            showToast(err, 'error');
            return;
        }
        loadPreview(file);
    }

    // ============================================================
    //  上传交互
    // ============================================================
    function openFilePicker() {
        if (currentState === STATE.PROCESSING) return;
        fileInput.click();
    }

    dropzone.addEventListener('click', function (e) {
        if (e.target.closest('.dzp-clear')) return;
        openFilePicker();
    });

    dropzone.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openFilePicker();
        }
    });

    fileInput.addEventListener('change', function (e) {
        handleFiles(e.target.files);
        e.target.value = '';
    });

    browseLink.addEventListener('click', function (e) {
        e.stopPropagation();
        openFilePicker();
    });

    // 拖拽
    var dragCounter = 0;
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(function (evt) {
        dropzone.addEventListener(evt, function (e) {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });
    dropzone.addEventListener('dragenter', function () {
        if (currentState === STATE.PROCESSING) return;
        dragCounter++;
        if (dragCounter === 1) dropzone.classList.add('drag-over');
    }, false);
    dropzone.addEventListener('dragleave', function () {
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            dropzone.classList.remove('drag-over');
        }
    }, false);
    dropzone.addEventListener('drop', function (e) {
        dragCounter = 0;
        dropzone.classList.remove('drag-over');
        if (currentState === STATE.PROCESSING) return;
        if (e.dataTransfer && e.dataTransfer.files) {
            handleFiles(e.dataTransfer.files);
        }
    }, false);

    removeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (currentState === STATE.PROCESSING) {
            showToast('处理中，暂无法更换', 'error');
            return;
        }
        resetUpload();
    });

    function resetUpload() {
        currentFile = null;
        originalDataUrl = '';
        fileInput.value = '';
        previewImg.src = '';
        dzpName.textContent = 'image.png';
        dzpSize.textContent = '2.4 MB';
        dropzonePreview.classList.remove('in');
        dropzoneEmpty.hidden = false;
        dropzonePreview.hidden = true;
    }

    // 编辑器内重新上传
    reuploadBtn.addEventListener('click', function () {
        if (currentState === STATE.PROCESSING) {
            showToast('处理中，暂无法更换', 'error');
            return;
        }
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/jpeg,image/png,image/webp';
        input.onchange = function (e) {
            handleFiles(e.target.files);
        };
        input.click();
    });

    // ============================================================
    //  编辑器控制面板
    // ============================================================
    // 约束标签点击
    var cTags = constraintTags.querySelectorAll('.c-tag');
    cTags.forEach(function (tag) {
        tag.addEventListener('click', function () {
            var prompt = tag.dataset.prompt;
            if (!prompt) return;

            var current = promptInput.value.trim();
            if (current) {
                promptInput.value = current + '，' + prompt;
            } else {
                promptInput.value = prompt;
            }

            // 视觉反馈
            cTags.forEach(function (t) { t.classList.remove('active'); });
            tag.classList.add('active');
            setTimeout(function () { tag.classList.remove('active'); }, 400);

            promptInput.focus();
        });
    });

    // 生成按钮
    generateBtn.addEventListener('click', function () {
        if (currentState === STATE.PROCESSING) return;
        if (!currentFile || !originalDataUrl) {
            showToast('请先上传图片', 'error');
            return;
        }
        startGenerate();
    });

    // ============================================================
    //  AI 服务层（可替换为真实 API）
    //  接入方式：
    //  1. 设置 CONFIG.API.useApi = true
    //  2. 设置 CONFIG.API.endpoint 为后端接口地址
    //  3. 后端需接收：POST multipart/form-data { image, prompt }
    //  4. 后端返回：{ imageUrl: "data:image/png;base64,..." 或 URL }
    // ============================================================
    var AIService = {
        /**
         * 生成图片
         * @param {File} file - 图片文件
         * @param {string} prompt - 修改需求描述
         * @param {object} callbacks - { onProgress, onSuccess, onError }
         */
        generate: function (file, prompt, callbacks) {
            if (CONFIG.API.useApi) {
                this._callApi(file, prompt, callbacks);
            } else {
                this._simulateLocal(file, prompt, callbacks);
            }
        },

        _callApi: function (file, prompt, callbacks) {
            var onProgress = callbacks.onProgress || function () {};
            var onSuccess = callbacks.onSuccess || function () {};
            var onError = callbacks.onError || function () {};

            var formData = new FormData();
            formData.append('image', file);
            formData.append('prompt', prompt);

            var xhr = new XMLHttpRequest();
            xhr.open('POST', CONFIG.API.endpoint, true);
            xhr.timeout = CONFIG.API.timeout;

            if (CONFIG.API.token) {
                xhr.setRequestHeader('Authorization', 'Bearer ' + CONFIG.API.token);
            }

            // 上传进度
            xhr.upload.onprogress = function (e) {
                if (e.lengthComputable) {
                    var percent = Math.round((e.loaded / e.total) * 40); // 上传占 40%
                    onProgress(percent);
                }
            };

            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        var resp = JSON.parse(xhr.responseText);
                        var imageUrl = resp.imageUrl || resp.data?.imageUrl || resp.url;
                        if (!imageUrl) {
                            onError('返回数据格式错误：缺少 imageUrl');
                            return;
                        }
                        onProgress(100);
                        setTimeout(function () { onSuccess(imageUrl); }, 200);
                    } catch (e) {
                        onError('解析响应失败：' + e.message);
                    }
                } else {
                    onError('请求失败（' + xhr.status + '）：' + (xhr.statusText || '服务器错误'));
                }
            };

            xhr.onerror = function () {
                onError('网络错误，请检查网络连接或接口地址');
            };

            xhr.ontimeout = function () {
                onError('请求超时，请稍后重试');
            };

            xhr.send(formData);
        },

        _simulateLocal: function (file, prompt, callbacks) {
            var onProgress = callbacks.onProgress || function () {};
            var onSuccess = callbacks.onSuccess || function () {};
            var onError = callbacks.onError || function () {};

            var img = new Image();
            img.onload = function () {
                var canvas = document.createElement('canvas');
                var ctx = canvas.getContext('2d');
                var maxSide = 1600;
                var w = img.naturalWidth, h = img.naturalHeight;
                if (Math.max(w, h) > maxSide) {
                    var scale = maxSide / Math.max(w, h);
                    w = Math.round(w * scale);
                    h = Math.round(h * scale);
                }
                canvas.width = w;
                canvas.height = h;

                ctx.filter = getFilterByPrompt(prompt);
                ctx.drawImage(img, 0, 0, w, h);

                var p = 0;
                var timer = setInterval(function () {
                    p += 2 + Math.random() * 4;
                    if (p >= 100) {
                        p = 100;
                        clearInterval(timer);
                        onProgress(100);
                        setTimeout(function () {
                            try {
                                onSuccess(canvas.toDataURL('image/png'));
                            } catch (e) {
                                onError('生成结果失败');
                            }
                        }, 300);
                    } else {
                        onProgress(p);
                    }
                }, 90);
            };
            img.onerror = function () {
                onError('图片加载失败，请检查文件是否正常');
            };
            img.src = originalDataUrl;
        }
    };

    function getFilterByPrompt(prompt) {
        var lower = prompt.toLowerCase();
        if (lower.indexOf('胶片') !== -1 || lower.indexOf('复古') !== -1) {
            return 'sepia(0.14) contrast(1.18) brightness(0.96) saturate(1.15)';
        }
        if (lower.indexOf('人像') !== -1 || lower.indexOf('磨皮') !== -1) {
            return 'brightness(1.06) contrast(0.96) saturate(0.92) blur(0.6px)';
        }
        if (lower.indexOf('风景') !== -1 || lower.indexOf('自然') !== -1) {
            return 'saturate(1.28) contrast(1.1) brightness(1.02)';
        }
        if (lower.indexOf('清晰') !== -1 || lower.indexOf('锐化') !== -1) {
            return 'contrast(1.15) saturate(1.1) brightness(1.03)';
        }
        if (lower.indexOf('提亮') !== -1 || lower.indexOf('亮度') !== -1) {
            return 'brightness(1.12) contrast(1.05) saturate(1.08)';
        }
        return 'contrast(1.12) saturate(1.08) brightness(1.03)';
    }

    var procTimer = null;

    function updateProgress(percent) {
        percent = Math.max(0, Math.min(100, Number(percent) || 0));
        return percent;
    }

    function startGenerate() {
        var prompt = promptInput.value.trim();
        if (!prompt) {
            showToast('请描述你想如何修改图片', 'error');
            promptInput.focus();
            return;
        }

        setState(STATE.PROCESSING);
        resultEmpty.hidden = true;
        resultLoading.hidden = false;
        editorResultImg.hidden = true;

        AIService.generate(currentFile, prompt, {
            onProgress: updateProgress,
            onSuccess: function (imageUrl) {
                handleSuccess(imageUrl, prompt);
            },
            onError: handleError
        });
    }

    function handleSuccess(imageUrl, prompt) {
        enhancedDataUrl = imageUrl;

        var img = new Image();
        img.onload = function () {
            editorResultImg.src = imageUrl;
            editorResultImg.hidden = false;
            resultEmpty.hidden = true;
            resultLoading.hidden = true;

            setState(STATE.SUCCESS);
            showToast('AI 生成完成 · 结果已展示', 'success');

            addHistoryRecord(prompt || promptInput.value.trim(), imageUrl);
        };
        img.onerror = function () {
            handleError('图片生成结果加载失败');
        };
        img.src = imageUrl;
    }

    function handleError(message) {
        resultLoading.hidden = true;
        if (!editorResultImg.src) {
            resultEmpty.hidden = false;
        }
        setState(STATE.ERROR);
        showToast(message || '处理失败，请重试', 'error');
    }

    // ============================================================
    //  状态机
    // ============================================================
    function setState(newState) {
        if (currentState === newState) return;
        currentState = newState;

        if (newState === STATE.IDLE) {
            generateBtn.disabled = false;
            generateBtn.classList.remove('processing');
        } else if (newState === STATE.PROCESSING) {
            generateBtn.disabled = true;
            generateBtn.classList.add('processing');
        } else if (newState === STATE.SUCCESS) {
            generateBtn.disabled = false;
            generateBtn.classList.remove('processing');
        } else if (newState === STATE.ERROR) {
            generateBtn.disabled = false;
            generateBtn.classList.remove('processing');
        }
    }

    // ============================================================
    //  历史记录
    // ============================================================
    function addHistoryRecord(prompt, imageUrl) {
        var record = {
            id: Date.now(),
            prompt: prompt,
            imageUrl: imageUrl,
            time: new Date()
        };
        historyRecords.unshift(record);
        renderHistory();
    }

    function renderHistory() {
        var emptyHtml = '<div class="history-empty">暂无编辑记录，上传图片并生成结果后会自动保存到这里</div>';
        var homeEmptyHtml = '' +
            '<div class="home-history-empty">' +
                '<svg viewBox="0 0 40 40" fill="none">' +
                    '<circle cx="20" cy="20" r="16" stroke="currentColor" stroke-width="1.5" opacity="0.3"/>' +
                    '<path d="M20 12v8l5 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.3"/>' +
                '</svg>' +
                '<p>暂无编辑记录</p>' +
                '<span>上传图片并生成结果后，历史记录会自动保存到这里</span>' +
            '</div>';

        if (historyRecords.length === 0) {
            historyList.innerHTML = emptyHtml;
            homeHistoryList.innerHTML = homeEmptyHtml;
            if (homeHistoryBadge) homeHistoryBadge.textContent = '0 条记录';
            return;
        }

        // 更新徽章
        if (homeHistoryBadge) {
            homeHistoryBadge.textContent = historyRecords.length + ' 条记录';
        }

        var itemsHtml = '';
        homeHistoryList.innerHTML = '';
        historyList.innerHTML = '';

        historyRecords.forEach(function (record) {
            var itemHtml =
                '<div class="history-item">' +
                    '<img class="history-item-thumb" src="' + record.imageUrl + '" alt="历史缩略图" />' +
                    '<div class="history-item-info">' +
                        '<div class="history-item-prompt">' + escapeHtml(record.prompt) + '</div>' +
                        '<div class="history-item-meta">' + formatTime(record.time) + ' · ' + currentFeature + '</div>' +
                    '</div>' +
                    '<div class="history-item-actions">' +
                        '<button class="history-item-btn" data-action="view" data-id="' + record.id + '" type="button">查看</button>' +
                        '<button class="history-item-btn" data-action="download" data-id="' + record.id + '" type="button">下载</button>' +
                    '</div>' +
                '</div>';

            // 同时添加到两个列表
            historyList.innerHTML += itemHtml;
            homeHistoryList.innerHTML += itemHtml;
        });

        // 绑定历史记录按钮事件（两个列表）
        bindHistoryButtons(historyList);
        bindHistoryButtons(homeHistoryList);
    }

    function bindHistoryButtons(container) {
        container.querySelectorAll('.history-item-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var action = btn.dataset.action;
                var id = parseInt(btn.dataset.id, 10);
                var record = historyRecords.find(function (r) { return r.id === id; });
                if (!record) return;

                if (action === 'view') {
                    // 切换到编辑器并加载
                    if (editorView.hidden) {
                        showEditor();
                    }
                    editorResultImg.src = record.imageUrl;
                    editorResultImg.hidden = false;
                    resultEmpty.hidden = true;
                    resultLoading.hidden = true;
                    promptInput.value = record.prompt;
                    showToast('已加载历史版本', 'info');
                } else if (action === 'download') {
                    downloadImage(record.imageUrl, 'ApertureLab_' + record.id + '.png');
                }
            });
        });
    }

    function escapeHtml(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ============================================================
    //  下载 & 复制
    // ============================================================
    function downloadImage(dataUrl, filename) {
        if (!dataUrl) { showToast('暂无图片可下载', 'error'); return; }
        var link = document.createElement('a');
        link.href = dataUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast('图片已开始下载', 'success');
    }

    function dataUrlToBlob(dataUrl) {
        var parts = dataUrl.split(',');
        var header = parts[0];
        var base64 = parts[1];
        var mime = header.match(/:(.*?);/);
        mime = mime ? mime[1] : 'image/png';
        var binary = atob(base64);
        var len = binary.length;
        var buffer = new Uint8Array(len);
        for (var i = 0; i < len; i++) {
            buffer[i] = binary.charCodeAt(i);
        }
        return new Blob([buffer], { type: mime });
    }

    function copyImage(dataUrl) {
        if (!dataUrl) { showToast('暂无图片可复制', 'error'); return; }
        if (!navigator.clipboard || !window.ClipboardItem) {
            showToast('当前浏览器不支持复制图片，请使用下载', 'error');
            return;
        }
        var blob = dataUrlToBlob(dataUrl);
        var item = new ClipboardItem({ [blob.type]: blob });
        navigator.clipboard.write([item])
            .then(function () { showToast('图片已复制到剪贴板', 'success'); })
            .catch(function () { showToast('复制失败，请使用下载功能', 'error'); });
    }

    // ============================================================
    //  AI 对话模块
    // ============================================================
    function addChatMessage(text, sender) {
        sender = sender || 'bot';
        var msg = document.createElement('div');
        msg.className = 'chat-msg ' + sender;
        msg.innerHTML =
            '<div class="chat-msg-avatar">AI</div>' +
            '<div class="chat-msg-bubble">' + escapeHtml(text).replace(/\n/g, '<br>') + '</div>';
        chatMessages.appendChild(msg);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function getBotReply(userText) {
        var lower = userText.toLowerCase();
        for (var i = 0; i < CHAT_RULES.length; i++) {
            var rule = CHAT_RULES[i];
            for (var j = 0; j < rule.keywords.length; j++) {
                if (lower.indexOf(rule.keywords[j]) !== -1) {
                    return rule.reply;
                }
            }
        }
        return '我理解你想了解「' + userText + '」。你可以尝试以下操作：\n1. 在首页选择修图功能并上传图片\n2. 在编辑器中描述具体的修改需求\n3. 点击「生成结果」查看 AI 处理效果\n\n如果需要更多帮助，可以点击右上角问号查看使用说明。';
    }

    function sendChatMessage(text) {
        text = (text || '').trim();
        if (!text) return;
        addChatMessage(text, 'user');
        setTimeout(function () {
            var reply = getBotReply(text);
            addChatMessage(reply, 'bot');
        }, 600);
    }

    chatSend.addEventListener('click', function () {
        sendChatMessage(chatInput.value);
        chatInput.value = '';
    });

    chatInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            sendChatMessage(chatInput.value);
            chatInput.value = '';
        }
    });

    var quickBtns = chatQuick.querySelectorAll('.chat-quick-btn');
    quickBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
            var q = btn.dataset.quick;
            sendChatMessage(q);
        });
    });

    // 折叠/展开
    chatToggle.addEventListener('click', function (e) {
        e.stopPropagation();
        aiChat.classList.toggle('collapsed');
    });

    var chatHeader = aiChat.querySelector('.ai-chat-header');
    if (chatHeader) {
        chatHeader.addEventListener('click', function (e) {
            if (e.target.closest('.ai-chat-toggle')) return;
            aiChat.classList.toggle('collapsed');
        });
    }

    // ============================================================
    //  全局快捷键
    // ============================================================
    document.addEventListener('keydown', function (e) {
        if (!modal.hidden) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        // Ctrl/Cmd + Enter 触发生成
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            if (!editorView.hidden && currentState === STATE.IDLE && currentFile) {
                e.preventDefault();
                generateBtn.click();
            }
        }
    });

    // ============================================================
    //  首屏入场
    // ============================================================
    function pageReveal() {
        var els = document.querySelectorAll('[data-reveal]');
        els.forEach(function (el) {
            var delay = parseInt(el.getAttribute('data-reveal'), 10) || 0;
            el.style.animationDelay = (delay / 1000) + 's';
            el.classList.add('reveal');
        });
    }

    // ============================================================
    //  初始化
    // ============================================================
    function init() {
        // 默认选中第一个功能卡片
        var defaultCard = document.querySelector('.feature-card[data-feature="enhance"]');
        if (defaultCard) defaultCard.classList.add('active');

        // AI 对话默认折叠
        aiChat.classList.add('collapsed');

        // 渲染历史记录（空状态）
        renderHistory();

        // 设置初始状态
        setState(STATE.IDLE);

        // 执行入场动画
        pageReveal();

        showToast('Aperture Lab 已就绪 · 选择功能并上传图片', 'info');
    }

    init();

    // 全局接口：外部调用
    window.AIEnhance = {
        start: startGenerate,
        onProgress: updateProgress,
        onSuccess: handleSuccess,
        onError: handleError,
        // 配置入口：外部可直接修改配置
        config: CONFIG,
        // 服务层入口
        service: AIService
    };

})();
