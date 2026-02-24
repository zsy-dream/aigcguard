class TextWatermarkService:
    # 使用常见的不可见零宽字符 (Zero-width chars)
    ZW_SPA = '\u200b' # Zero-width space (0)
    ZW_NON = '\u200c' # Zero-width non-joiner (1)
    ZW_JOIN = '\u200d' # Zero-width joiner (BOUNDARY)
    
    @staticmethod
    def embed(text: str, watermark_str: str) -> str:
        """
        在普通文本中隐写不可见水印
        原理: 将明文转换为二进制流，然后用不同的零宽字符表示 0 和 1
        """
        if not text:
            return text
            
        # 1. 字符串转二进制流
        binary_str = ''.join(format(ord(char), '08b') for char in watermark_str)
        
        # 2. 映射为不可见字符
        hidden_chars = ""
        for bit in binary_str:
            hidden_chars += TextWatermarkService.ZW_SPA if bit == '0' else TextWatermarkService.ZW_NON
            
        # 3. 把它们用 ZW_JOIN 包裹起来，当作特征识别的头和尾边界
        encoded_watermark = TextWatermarkService.ZW_JOIN + hidden_chars + TextWatermarkService.ZW_JOIN
        
        # 4. 把水印塞进文本中间（比如第一个字后面，这样被别人前中后截断截一半也有存活可能）
        # 商业化中可以每隔 N 段落重复注入
        insert_pos = min(1, len(text))
        watermarked_text = text[:insert_pos] + encoded_watermark + text[insert_pos:]
        
        return watermarked_text
        
    @staticmethod
    def extract(text: str) -> str:
        """
        从被粘贴盗用的文本中提取零宽字符隐写水印
        """
        if not text:
            return ""
            
        # 寻找边界标记
        start = text.find(TextWatermarkService.ZW_JOIN)
        if start == -1:
            return "No watermark found"
            
        end = text.find(TextWatermarkService.ZW_JOIN, start + 1)
        if end == -1:
            return "Corrupted watermark"
            
        # 抽取并解析隐藏的二进制流
        hidden_chars = text[start + 1:end]
        binary_str = ""
        
        for char in hidden_chars:
            if char == TextWatermarkService.ZW_SPA:
                binary_str += '0'
            elif char == TextWatermarkService.ZW_NON:
                binary_str += '1'
                
        # 还原回原文文本
        chars = [binary_str[i:i+8] for i in range(0, len(binary_str), 8)]
        watermark = ""
        for b in chars:
            try:
                watermark += chr(int(b, 2))
            except Exception:
                pass
                
        return watermark
