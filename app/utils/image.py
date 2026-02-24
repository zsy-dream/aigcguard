import cv2
import numpy as np
from fastapi import UploadFile

def load_image_bytes(file_bytes: bytes):
    nparr = np.frombuffer(file_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    return img

def load_image_from_path(path: str):
    return cv2.imread(path)
