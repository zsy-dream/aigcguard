"""
图像相似度匹配引擎
支持 pHash, dHash 等感知哈希算法
"""
import cv2
import numpy as np
import imagehash
from PIL import Image
from typing import Tuple

class ImageMatcher:
    """图像相似度匹配器"""
    
    def __init__(self, threshold: int = 10):
        """
        初始化匹配器
        
        Args:
            threshold: 汉明距离阈值 (0-64, 越小越严格)
        """
        self.threshold = threshold
    
    def calculate_phash(self, image_path: str) -> str:
        """
        计算感知哈希 (pHash)
        
        Args:
            image_path: 图像路径
            
        Returns:
            哈希值字符串
        """
        img = Image.open(image_path)
        return str(imagehash.phash(img))
    
    def calculate_dhash(self, image_path: str) -> str:
        """计算差分哈希 (dHash)"""
        img = Image.open(image_path)
        return str(imagehash.dhash(img))
    
    def calculate_similarity(self, hash1: str, hash2: str) -> float:
        """
        计算两个哈希的相似度
        
        Args:
            hash1: 第一个哈希值
            hash2: 第二个哈希值
            
        Returns:
            相似度 (0-1, 1表示完全相同)
        """
        hamming_distance = bin(int(hash1, 16) ^ int(hash2, 16)).count('1')
        similarity = 1 - (hamming_distance / 64.0)
        return similarity
    
    def is_match(self, hash1: str, hash2: str) -> bool:
        """判断两个哈希是否匹配"""
        hamming_distance = bin(int(hash1, 16) ^ int(hash2, 16)).count('1')
        return hamming_distance <= self.threshold
    
    def extract_features_sift(self, image: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        """
        使用 SIFT 提取图像特征点
        
        Args:
            image: 输入图像
            
        Returns:
            关键点和描述符
        """
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        sift = cv2.SIFT_create()
        keypoints, descriptors = sift.detectAndCompute(gray, None)
        return keypoints, descriptors
    
    def match_features(self, desc1: np.ndarray, desc2: np.ndarray, ratio: float = 0.75) -> int:
        """
        使用 FLANN 匹配特征点
        
        Args:
            desc1: 第一组描述符
            desc2: 第二组描述符
            ratio: Lowe's ratio test 阈值
            
        Returns:
            匹配点数量
        """
        if desc1 is None or desc2 is None:
            return 0
        
        # FLANN 匹配器
        FLANN_INDEX_KDTREE = 1
        index_params = dict(algorithm=FLANN_INDEX_KDTREE, trees=5)
        search_params = dict(checks=50)
        flann = cv2.FlannBasedMatcher(index_params, search_params)
        
        matches = flann.knnMatch(desc1, desc2, k=2)
        
        # Lowe's ratio test
        good_matches = []
        for m_n in matches:
            if len(m_n) == 2:
                m, n = m_n
                if m.distance < ratio * n.distance:
                    good_matches.append(m)
        
        return len(good_matches)
