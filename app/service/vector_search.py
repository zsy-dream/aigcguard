import os
import json
import logging

logger = logging.getLogger("app")

# 尝试导入深度学习依赖，失败时标记为不可用
try:
    import faiss
    import numpy as np
    from PIL import Image
    import torch
    import torchvision.models as models
    import torchvision.transforms as transforms
    _DEEP_LEARNING_AVAILABLE = True
except ImportError as e:
    logger.warning(f"[VectorSearch] 深度学习依赖未安装: {e}")
    logger.warning("[VectorSearch] 深度特征检索功能已禁用，仅使用传统水印检测")
    _DEEP_LEARNING_AVAILABLE = False
    faiss = None
    np = None
    torch = None
    models = None
    transforms = None


class VectorSearchService:
    def __init__(self, index_path="data/faiss_deep.index", map_path="data/faiss_deep_map.json"):
        self.index_path = index_path
        self.map_path = map_path
        self._available = _DEEP_LEARNING_AVAILABLE
        
        if not self._available:
            logger.info("[VectorSearch] 服务未启用（缺少依赖）")
            return
        
        # 使用 MobileNetV3 Small (轻量级) 提取特征
        self.device = torch.device("cpu")
        self.model = models.mobilenet_v3_small(weights=models.MobileNet_V3_Small_Weights.IMAGENET1K_V1)
        self.model.eval()
        self.model.to(self.device)
        
        # MobileNetV3 output is 1000 dim
        self.dim = 1000 
        
        self.transform = transforms.Compose([
            transforms.Resize(256),
            transforms.CenterCrop(224),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])
        
        os.makedirs(os.path.dirname(self.index_path), exist_ok=True)
        
        if os.path.exists(self.index_path) and os.path.exists(self.map_path):
            self.index = faiss.read_index(self.index_path)
            with open(self.map_path, 'r', encoding='utf-8') as f:
                self.id_to_asset_id = json.load(f)
            self.id_to_asset_id = {int(k): v for k, v in self.id_to_asset_id.items()}
        else:
            # IndexFlatIP 用作余弦相似度检索 (前提：向量必须归一化)
            self.index = faiss.IndexFlatIP(self.dim)
            self.id_to_asset_id = {}

    def _extract_feature(self, img) -> 'np.ndarray | None':
        """P0: 深层 AI 脑补特征提取防御重绘"""
        if not self._available:
            return None
        # PIL Image 导入检查
        try:
            from PIL import Image
        except ImportError:
            return None
        # 类型检查
        if not hasattr(img, 'convert'):
            return None
        input_tensor = self.transform(img).unsqueeze(0).to(self.device)
        with torch.no_grad():
            output = self.model(input_tensor)
        
        vec = output.cpu().numpy()[0]
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec = vec / norm
        return vec.astype(np.float32)

    def add_image(self, file_path: str, asset_id: int):
        if not self._available:
            logger.debug("[VectorSearch] 服务未启用，跳过 add_image")
            return
        try:
            from PIL import Image
            img = Image.open(file_path).convert('RGB')
            vec = self._extract_feature(img)
            if vec is None:
                return
            vec = vec.reshape(1, -1)
            
            faiss_id = self.index.ntotal
            self.index.add(vec)
            self.id_to_asset_id[faiss_id] = asset_id
            
            self._save()
        except Exception as e:
            logger.error(f"[FAISS DEEP ERROR] Failed to index {file_path}: {e}")
        
    def search(self, img, top_k=1, threshold=0.75):
        """
        利用 FAISS + 深度特征扫描库中数据，即使通过 AI 重绘依然保留深层图形学相似度
        """
        if not self._available:
            return None
        try:
            from PIL import Image
        except ImportError:
            return None
        # 类型检查
        if not hasattr(img, 'convert'):
            return None
        if self.index.ntotal == 0:
            return None
            
        vec = self._extract_feature(img)
        if vec is None:
            return None
        vec = vec.reshape(1, -1)
        distances, indices = self.index.search(vec, top_k)
        
        idx = indices[0][0]
        similarity = float(distances[0][0]) # Inner Product
        
        if idx == -1:
            return None
        
        # 如果余弦相似度极高则认为是二次加工或盗窃产物
        if similarity >= threshold:
            asset_id = self.id_to_asset_id.get(int(idx))
            return {
                "asset_id": asset_id,
                "similarity": similarity,
                "method": "mobilenet_v3_deep_feature"
            }
            
        return None

    def _save(self):
        if not self._available:
            return
        try:
            faiss.write_index(self.index, self.index_path)
            with open(self.map_path, 'w', encoding='utf-8') as f:
                json.dump(self.id_to_asset_id, f)
        except Exception as e:
            logger.error(f"[VectorSearch] 保存索引失败: {e}")

vector_service = VectorSearchService()
