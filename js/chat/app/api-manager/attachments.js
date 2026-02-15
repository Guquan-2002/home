/**
 * API manager attachment helpers.
 *
 * Responsibility:
 * - Manage pending image parts for user input
 * - Render attachment previews and remove actions
 * - Bind upload/paste events for images
 */

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => reject(new Error('Failed to read image file.'));
        reader.readAsDataURL(file);
    });
}

export function formatAttachmentNotice(count) {
    return count === 1 ? '已上传 1 张图片' : `已上传 ${count} 张图片`;
}

export function createAttachmentManager({
    elements,
    ui
}) {
    const {
        attachBtn = null,
        imageInput = null,
        attachmentsEl = null,
        chatInput
    } = elements;

    let pendingImageParts = [];
    let eventsBound = false;

    function updateAttachmentButtonState() {
        if (!attachBtn) {
            return;
        }

        attachBtn.classList.toggle('has-attachments', pendingImageParts.length > 0);
        attachBtn.title = pendingImageParts.length > 0
            ? formatAttachmentNotice(pendingImageParts.length)
            : 'Attach images';
    }

    function renderAttachmentPreview() {
        if (!attachmentsEl) {
            updateAttachmentButtonState();
            return;
        }

        attachmentsEl.innerHTML = '';
        pendingImageParts.forEach((part, index) => {
            const chip = document.createElement('div');
            chip.className = 'chat-attachment-chip';

            const image = document.createElement('img');
            image.src = part.image.value;
            image.alt = `attachment-${index + 1}`;
            chip.appendChild(image);

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'chat-attachment-remove';
            removeBtn.textContent = '锟斤拷';
            removeBtn.title = 'Remove image';
            removeBtn.addEventListener('click', () => {
                pendingImageParts = pendingImageParts.filter((_, i) => i !== index);
                renderAttachmentPreview();
            });
            chip.appendChild(removeBtn);

            attachmentsEl.appendChild(chip);
        });

        updateAttachmentButtonState();
    }

    function clearPendingImages() {
        pendingImageParts = [];
        if (imageInput) {
            imageInput.value = '';
        }
        renderAttachmentPreview();
    }

    async function appendImageFiles(files) {
        if (!Array.isArray(files) || files.length === 0) {
            return;
        }

        const nextParts = [];
        for (const file of files) {
            if (!file || typeof file.type !== 'string' || !file.type.startsWith('image/')) {
                continue;
            }

            const dataUrl = await fileToDataUrl(file);
            if (!dataUrl) {
                continue;
            }

            nextParts.push({
                type: 'image',
                image: {
                    sourceType: 'data_url',
                    value: dataUrl,
                    mimeType: file.type
                }
            });
        }

        if (nextParts.length === 0) {
            return;
        }

        pendingImageParts = [...pendingImageParts, ...nextParts];
        renderAttachmentPreview();
    }

    function getPendingImageParts() {
        return pendingImageParts;
    }

    function bindAttachmentEvents() {
        if (eventsBound) {
            return;
        }
        eventsBound = true;

        if (attachBtn && imageInput) {
            attachBtn.addEventListener('click', () => {
                imageInput.click();
            });

            imageInput.addEventListener('change', async () => {
                const files = Array.from(imageInput.files || []);
                try {
                    await appendImageFiles(files);
                } catch (error) {
                    ui.addSystemNotice(error?.message || 'Failed to attach image.', 3000);
                } finally {
                    imageInput.value = '';
                }
            });
        }

        if (chatInput) {
            chatInput.addEventListener('paste', async (event) => {
                const items = Array.from(event.clipboardData?.items || []);
                const imageFiles = items
                    .filter((item) => typeof item?.type === 'string' && item.type.startsWith('image/'))
                    .map((item) => item.getAsFile())
                    .filter(Boolean);

                if (imageFiles.length === 0) {
                    return;
                }

                event.preventDefault();
                try {
                    await appendImageFiles(imageFiles);
                } catch (error) {
                    ui.addSystemNotice(error?.message || 'Failed to paste image.', 3000);
                }
            });
        }
    }

    return {
        appendImageFiles,
        bindAttachmentEvents,
        clearPendingImages,
        getPendingImageParts,
        renderAttachmentPreview
    };
}

