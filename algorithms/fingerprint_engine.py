"""
数字指纹嵌入引擎 - 核心算法实现
支持 DCT 和 DWT 频域水印嵌入
完整实现：水印可真实嵌入、提取，支持数据库溯源比对

性能优化:
  - 批量矩阵 DCT 替代逐块 cv2.dct（numpy 矩阵乘法一次完成）
  - 查找表加速 hex↔binary 转换
  - quick_extract_dct 快速预检（32 位采样）
"""
import cv2
import numpy as np
import pywt
from typing import Tuple, Optional
import hashlib


def _build_dct_matrix(n: int = 8) -> np.ndarray:
    """构建 n×n 正交 DCT-II 变换矩阵（与 cv2.dct 等价）"""
    C = np.zeros((n, n), dtype=np.float32)
    for k in range(n):
        for i in range(n):
            if k == 0:
                C[k, i] = 1.0 / np.sqrt(n)
            else:
                C[k, i] = np.sqrt(2.0 / n) * np.cos(np.pi * k * (2 * i + 1) / (2 * n))
    return C


# ---- 模块级常量（仅计算一次） ----
_DCT8: np.ndarray = _build_dct_matrix(8)       # (8,8) 正交 DCT 矩阵
_DCT8T: np.ndarray = _DCT8.T.copy()            # 转置（= 逆变换矩阵）

# hex → 4-bit binary 查找表
_HEX2BIN = {c: format(i, '04b') for i, c in enumerate('0123456789abcdef')}
# 4-bit binary → hex 查找表
_BIN2HEX = {format(i, '04b'): hex(i)[2:] for i in range(16)}


class FingerprintEngine:
    """数字指纹嵌入与提取引擎 - 完整可用的水印算法（向量化优化版）"""

    # 完整 SHA256 指纹 = 64 个十六进制字符 = 256 位
    FINGERPRINT_BITS = 256

    # QIM 量化步长：嵌入与提取必须一致
    # Q=30 提供 ±7.5 的误差容忍度，远大于 uint8 取整 + YCrCb 转换的典型误差(±2-4)
    # 旧值 Q=8 容忍度仅 ±2，导致提取相似度仅 ~0.71
    QIM_STEP = 30.0

    def __init__(self, strength: float = 0.1, block_size: int = 8):
        """
        初始化指纹引擎

        Args:
            strength: 水印强度 (0.05-0.2 推荐，越大越鲁棒但越可见)
            block_size: DCT 块大小 (通常为 8)
        """
        self.strength = strength
        self.block_size = block_size

    def generate_fingerprint(self, user_id: str, timestamp: str) -> str:
        """
        生成唯一指纹ID (SHA256 哈希，64位十六进制)

        Args:
            user_id: 用户ID
            timestamp: 时间戳

        Returns:
            64字符十六进制指纹哈希
        """
        data = f"{user_id}:{timestamp}"
        return hashlib.sha256(data.encode()).hexdigest()

    # ------------------------------------------------------------------ #
    #  hex ↔ binary 转换（查找表加速）
    # ------------------------------------------------------------------ #

    def _hex_to_binary(self, hex_str: str) -> str:
        """将十六进制指纹转换为二进制序列 (每字符4位) —— 查找表版本"""
        return ''.join(_HEX2BIN.get(c, '') for c in hex_str.lower())

    def _binary_to_hex(self, binary: str) -> str:
        """将二进制序列转回十六进制 —— 查找表版本"""
        hex_chars = []
        for i in range(0, len(binary) - 3, 4):
            chunk = binary[i:i + 4]
            h = _BIN2HEX.get(chunk)
            if h is not None:
                hex_chars.append(h)
        return ''.join(hex_chars)

    def _hex_to_bits_array(self, hex_str: str, length: int = 256) -> np.ndarray:
        """hex 直接转为 numpy float32 位数组，供向量化 DCT 使用"""
        binary = self._hex_to_binary(hex_str)
        if len(binary) < length:
            binary = binary.ljust(length, '0')
        return np.array([float(b) for b in binary[:length]], dtype=np.float32)

    # ------------------------------------------------------------------ #
    #  块坐标 / 块提取 工具
    # ------------------------------------------------------------------ #

    @staticmethod
    def _block_positions(h: int, w: int, bs: int, n: int):
        """返回前 n 个非重叠块的 (row, col) 坐标列表"""
        cols_per_row = (w - bs) // bs + 1 if w > bs else 0
        rows = (h - bs) // bs + 1 if h > bs else 0
        # 与旧代码 range(0, h-bs, bs) 一致
        cols_per_row = len(range(0, w - bs, bs)) if w > bs else 0
        total = len(range(0, h - bs, bs)) * cols_per_row if h > bs else 0
        n = min(n, total)
        col_positions = list(range(0, w - bs, bs))
        positions = []
        k = 0
        for ri in range(0, h - bs, bs):
            for ci in col_positions:
                if k >= n:
                    return positions
                positions.append((ri, ci))
                k += 1
        return positions

    @staticmethod
    def _extract_blocks(y: np.ndarray, positions, bs: int) -> np.ndarray:
        """从 Y 通道提取指定位置的块 → (N, bs, bs)"""
        return np.stack([y[r:r + bs, c:c + bs] for r, c in positions])

    @staticmethod
    def _place_blocks(y: np.ndarray, blocks: np.ndarray, positions, bs: int):
        """将处理后的块写回 Y 通道（原地修改）"""
        for k, (r, c) in enumerate(positions):
            y[r:r + bs, c:c + bs] = blocks[k]

    # ------------------------------------------------------------------ #
    #  批量矩阵 DCT / IDCT
    # ------------------------------------------------------------------ #

    @staticmethod
    def _batch_dct(blocks: np.ndarray) -> np.ndarray:
        """(N,8,8) → (N,8,8) 批量 2D-DCT（矩阵乘法）"""
        return _DCT8 @ blocks @ _DCT8T

    @staticmethod
    def _batch_idct(blocks: np.ndarray) -> np.ndarray:
        """(N,8,8) → (N,8,8) 批量 2D-IDCT"""
        return _DCT8T @ blocks @ _DCT8

    # ------------------------------------------------------------------ #
    #  DCT 嵌入（向量化版本）
    # ------------------------------------------------------------------ #

    def embed_dct(self, image: np.ndarray, fingerprint: str) -> np.ndarray:
        """
        使用 DCT 算法嵌入水印 - 完整嵌入 256 位指纹（批量向量化）

        Args:
            image: 输入图像 (BGR格式)
            fingerprint: 64字符十六进制指纹

        Returns:
            嵌入水印后的图像
        """
        ycrcb = cv2.cvtColor(image, cv2.COLOR_BGR2YCrCb)
        y_channel = ycrcb[:, :, 0].astype(np.float32)

        # 指纹转位数组
        bits = self._hex_to_bits_array(fingerprint, self.FINGERPRINT_BITS)
        n_bits = len(bits)

        h, w = y_channel.shape
        bs = self.block_size
        Q = self.QIM_STEP

        # 计算块坐标
        positions = self._block_positions(h, w, bs, n_bits)
        n_embed = len(positions)
        if n_embed == 0:
            ycrcb[:, :, 0] = np.clip(y_channel, 0, 255).astype(np.uint8)
            return cv2.cvtColor(ycrcb, cv2.COLOR_YCrCb2BGR)

        bits = bits[:n_embed]

        # 批量提取 → 批量 DCT
        blocks = self._extract_blocks(y_channel, positions, bs)  # (N,8,8)
        dct_blocks = self._batch_dct(blocks)                     # (N,8,8)

        # 向量化 QIM 调制
        coeffs = dct_blocks[:, 2, 3]          # (N,)
        base = np.round(coeffs / Q) * Q       # (N,)
        dct_blocks[:, 2, 3] = base + bits * (Q / 2)

        # 批量 IDCT → 写回
        idct_blocks = self._batch_idct(dct_blocks)
        watermarked = y_channel.copy()
        self._place_blocks(watermarked, idct_blocks, positions, bs)

        ycrcb[:, :, 0] = np.clip(watermarked, 0, 255).astype(np.uint8)
        return cv2.cvtColor(ycrcb, cv2.COLOR_YCrCb2BGR)

    # ------------------------------------------------------------------ #
    #  DCT 提取（向量化版本）
    # ------------------------------------------------------------------ #

    def extract_dct(self, image: np.ndarray, length: int = 256) -> str:
        """
        从图像中提取 DCT 水印 - 盲提取，无需原图（批量向量化）

        Args:
            image: 待检测图像
            length: 提取的二进制位数 (默认256=完整指纹)

        Returns:
            提取的十六进制指纹
        """
        ycrcb = cv2.cvtColor(image, cv2.COLOR_BGR2YCrCb)
        y_channel = ycrcb[:, :, 0].astype(np.float32)

        h, w = y_channel.shape
        bs = self.block_size
        Q = self.QIM_STEP

        positions = self._block_positions(h, w, bs, length)
        n_extract = len(positions)
        if n_extract == 0:
            return ''

        # 批量提取 → 批量 DCT
        blocks = self._extract_blocks(y_channel, positions, bs)
        dct_blocks = self._batch_dct(blocks)

        # 向量化 QIM 解调（半步长量化：嵌入时 bit=1 偏移 Q/2，提取时按 Q/2 量化取模）
        coeffs = dct_blocks[:, 2, 3]
        half_quants = np.round(coeffs / (Q / 2)).astype(np.int32)
        bit_vals = half_quants % 2  # 0 或 1

        binary_str = ''.join(str(b) for b in bit_vals)
        return self._binary_to_hex(binary_str)

    # ------------------------------------------------------------------ #
    #  快速预检提取（仅采样少量位，用于判断是否已有水印）
    # ------------------------------------------------------------------ #

    def quick_extract_dct(self, image: np.ndarray, sample_bits: int = 32) -> str:
        """
        快速采样提取：仅提取前 sample_bits 位，用于判断图片是否已嵌入水印。
        相比 extract_dct(length=1024) 减少 >90% 的计算量。

        Returns:
            提取的短十六进制指纹片段
        """
        return self.extract_dct(image, length=sample_bits)

    # 历史 QIM 步长列表（旧版本使用 Q=8，当前版本使用 Q=30）
    LEGACY_QIM_STEPS = [8.0]

    def extract_dct_adaptive(self, image: np.ndarray, length: int = 256) -> tuple:
        """
        自适应 QIM 步长提取：先用当前 Q 提取，若指纹强度过低则回退尝试旧版 Q 值。
        解决 QIM_STEP 升级后旧水印无法提取的兼容性问题。

        Returns:
            (hex_fingerprint, used_qim_step)
        """
        # 1. 先用当前 QIM_STEP 提取
        fp = self.extract_dct(image, length=length)
        strength = sum(1 for c in fp if c != '0')
        if strength >= 15:  # 有效指纹
            return fp, self.QIM_STEP

        # 2. 回退尝试旧版 QIM_STEP
        saved_q = self.QIM_STEP
        best_fp, best_strength, best_q = fp, strength, saved_q
        try:
            for legacy_q in self.LEGACY_QIM_STEPS:
                self.QIM_STEP = legacy_q
                legacy_fp = self.extract_dct(image, length=length)
                legacy_strength = sum(1 for c in legacy_fp if c != '0')
                if legacy_strength > best_strength:
                    best_fp, best_strength, best_q = legacy_fp, legacy_strength, legacy_q
        finally:
            self.QIM_STEP = saved_q  # 恢复

        if best_q != saved_q:
            print(f"[FingerprintEngine] 使用旧版 QIM_STEP={best_q} 成功提取指纹 (强度={best_strength})")
        return best_fp, best_q

    def fingerprint_similarity(self, extracted: str, original: str) -> float:
        """
        计算两个指纹的相似度 (0-1)
        用于数据库比对，判断是否为同一作者
        
        Args:
            extracted: 提取的指纹
            original: 数据库中的原始指纹
            
        Returns:
            相似度 0-1，>0.85 可认为匹配
        """
        if not extracted or not original or len(original) < 8:
            return 0.0
        ext_bin = self._hex_to_binary(extracted)
        orig_bin = self._hex_to_binary(original)
        min_len = min(len(ext_bin), len(orig_bin))
        if min_len == 0:
            return 0.0
        matches = sum(1 for i in range(min_len) if ext_bin[i] == orig_bin[i])
        return matches / min_len
    
    def embed_dwt(self, image: np.ndarray, fingerprint: str) -> np.ndarray:
        """
        使用 DWT (小波变换) 嵌入水印
        
        Args:
            image: 输入图像
            fingerprint: 指纹字符串
            
        Returns:
            嵌入水印后的图像
        """
        ycrcb = cv2.cvtColor(image, cv2.COLOR_BGR2YCrCb)
        y_channel = ycrcb[:, :, 0].astype(np.float32)
        
        # 二级小波分解
        coeffs = pywt.dwt2(y_channel, 'haar')
        cA, (cH, cV, cD) = coeffs
        
        # 在低频分量嵌入
        binary_data = self._hex_to_binary(fingerprint)[:min(256, cA.size)]
        for i, bit in enumerate(binary_data[:min(len(binary_data), cA.size)]):
            row, col = divmod(i, cA.shape[1])
            if bit == '1':
                cA[row, col] += self.strength * abs(cA[row, col])
            else:
                cA[row, col] -= self.strength * abs(cA[row, col])
        
        # 重构图像
        watermarked = pywt.idwt2((cA, (cH, cV, cD)), 'haar')
        ycrcb[:, :, 0] = np.clip(watermarked, 0, 255).astype(np.uint8)
        result = cv2.cvtColor(ycrcb, cv2.COLOR_YCrCb2BGR)
        
        return result
    
    def calculate_robustness(self, original: np.ndarray, attacked: np.ndarray) -> dict:
        """
        计算水印鲁棒性指标
        
        Args:
            original: 原始嵌入水印的图像
            attacked: 经过攻击后的图像
            
        Returns:
            包含 PSNR, SSIM 等指标的字典
        """
        # PSNR (峰值信噪比)
        mse = np.mean((original.astype(float) - attacked.astype(float)) ** 2)
        psnr = 10 * np.log10(255**2 / mse) if mse > 0 else float('inf')
        
        return {
            "psnr": psnr,
            "mse": mse,
            "robust": psnr > 30  # PSNR > 30dB 认为质量良好
        }
