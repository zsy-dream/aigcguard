import React, { useState } from 'react';
import { Image as ImageIcon, Lock } from 'lucide-react';

interface AssetThumbnailProps {
    src: string;
    alt?: string;
    className?: string;
    assetType?: string;
    locked?: boolean;
}

const AssetThumbnail: React.FC<AssetThumbnailProps> = ({ src, alt, className, assetType = 'image', locked = false }) => {
    const [error, setError] = useState(false);

    if (locked) {
        return (
            <div className={`w-full h-full flex items-center justify-center bg-gray-900/80 backdrop-blur-md relative overflow-hidden ${className}`}>
                <div className="absolute inset-0 bg-gradient-to-br from-black/40 to-transparent"></div>
                <div className="relative z-10 flex flex-col items-center gap-1">
                    <div className="p-2 bg-white/5 rounded-full border border-white/10 shadow-inner">
                        <Lock size={14} className="text-amber-500/80" />
                    </div>
                </div>
            </div>
        );
    }

    if (error || !src) {
        return (
            <div className={`w-full h-full flex items-center justify-center bg-gray-900/50 ${className}`}>
                <ImageIcon size={16} className="text-gray-600" />
            </div>
        );
    }

    if (assetType === 'text') {
        return (
            <div className={`w-full h-full flex items-center justify-center bg-blue-500/10 ${className}`}>
                <div className="text-blue-400 font-bold text-[10px]">TXT</div>
            </div>
        );
    }

    if (assetType === 'video') {
        return (
            <div className={`w-full h-full flex items-center justify-center bg-indigo-500/10 ${className}`}>
                <div className="text-indigo-400 font-bold text-[10px]">MP4</div>
            </div>
        );
    }

    return (
        <img
            src={src}
            alt={alt || "thumbnail"}
            className={`${className} transition-opacity duration-300`}
            loading="lazy"
            decoding="async"
            onError={() => setError(true)}
        />
    );
};

export default AssetThumbnail;
