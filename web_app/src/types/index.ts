// Backend Pydantic Schemas mirrored
export interface User {
  id: string | number;
  username: string;
  role: string;
  display_name?: string;
  plan: string;
  quota_used: number;
  quota_total: number;
  quota_embed_used?: number | null;
  quota_embed_total?: number | null;
  quota_detect_used?: number | null;
  quota_detect_total?: number | null;
  subscription_status?: string | null;
  subscription_period?: string | null;
  subscription_started_at?: string | null;
  subscription_expires_at?: string | null;
  remaining_days?: number | null;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
}

export interface WatermarkResult {
  success: boolean;
  fingerprint?: string;
  psnr?: number;
  download_url?: string;
  asset_id?: number;
  error?: string;
  quota_deducted?: boolean;
  message: string;
}

export interface DetectionResult {
  success: boolean;
  has_watermark: boolean;
  extracted_fingerprint?: string;
  phash?: string;
  matched_asset?: string;
  matched_user_id?: string;
  author_name?: string;
  similarity: number;
  is_original_author: boolean;
  message: string;
}

export interface Asset {
  id: number;
  user_id: string;
  filename: string;
  fingerprint: string;
  timestamp: string;
  psnr?: number;
  output_path?: string;
  author_name?: string;
  preview_url?: string;
}

export interface Stats {
  total_assets: number;
  active_monitors: number;
  total_infringements: number;
}
