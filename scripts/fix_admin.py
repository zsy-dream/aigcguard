"""
修复管理员权限脚本
直接在 Supabase 中查询并更新当前用户为 admin
"""
import os
import sys

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from app.utils.supabase import get_supabase_service_client
except ImportError:
    # 备用：直接初始化 Supabase
    from dotenv import load_dotenv
    from supabase import create_client
    
    load_dotenv()
    
    def get_supabase_service_client():
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            print("❌ 缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY")
            return None
        try:
            return create_client(url, key)
        except Exception as e:
            print(f"❌ Supabase 初始化失败: {e}")
            return None

def fix_admin_role():
    sb = get_supabase_service_client()
    if not sb:
        print("❌ Supabase 客户端初始化失败，请检查 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY")
        return
    
    # 先查询所有用户，看看实际的 username/email
    print("🔍 查询 profiles 表中的用户...")
    users_res = sb.table("profiles").select("id, username, display_name, role, email").limit(10).execute()
    
    if not users_res.data:
        print("❌ profiles 表为空或查询失败")
        return
    
    print(f"\n找到 {len(users_res.data)} 个用户:\n")
    for u in users_res.data:
        print(f"  ID: {u.get('id', 'N/A')[:8]}... | Username: {u.get('username', 'N/A')} | "
              f"Display: {u.get('display_name', 'N/A')} | Role: {u.get('role', 'N/A')} | "
              f"Email: {u.get('email', 'N/A')}")
    
    # 尝试多种方式匹配 ZSY Pioneer
    target_patterns = [
        'zsypioneer@snapguard.com',
        'ZSY Pioneer',
        'zsy',
        'pioneer'
    ]
    
    target_user = None
    for pattern in target_patterns:
        for u in users_res.data:
            if (pattern.lower() in (u.get('username') or '').lower() or 
                pattern.lower() in (u.get('display_name') or '').lower() or
                pattern.lower() in (u.get('email') or '').lower()):
                target_user = u
                print(f"\n✅ 找到匹配用户: {u.get('username')} (ID: {u.get('id')[:8]}...)")
                break
        if target_user:
            break
    
    if not target_user:
        print("\n⚠️ 未找到匹配 'ZSY Pioneer' 的用户")
        print("请输入你要设为管理员的用户ID或username：")
        user_input = input("> ").strip()
        
        # 根据输入查询
        try:
            res = sb.table("profiles").select("*").eq("id", user_input).execute()
            if res.data:
                target_user = res.data[0]
            else:
                res = sb.table("profiles").select("*").eq("username", user_input).execute()
                if res.data:
                    target_user = res.data[0]
        except Exception as e:
            print(f"❌ 查询失败: {e}")
            return
    
    if not target_user:
        print("❌ 未找到用户")
        return
    
    user_id = target_user['id']
    current_role = target_user.get('role', 'N/A')
    
    print(f"\n📝 当前用户状态:")
    print(f"   ID: {user_id}")
    print(f"   Username: {target_user.get('username')}")
    print(f"   Display Name: {target_user.get('display_name')}")
    print(f"   Current Role: {current_role}")
    print(f"   Current Plan: {target_user.get('plan', 'N/A')}")
    
    if current_role == 'admin':
        print("\n✅ 用户已经是 admin，无需更新")
        return
    
    # 执行更新
    print(f"\n🔄 正在将用户设为 admin...")
    try:
        update_res = sb.table("profiles").update({
            "role": "admin",
            "plan": "enterprise",
            "quota_total": 9999999,
            "display_name": "ZSY Pioneer"
        }).eq("id", user_id).execute()
        
        if update_res.data:
            print("\n✅ 更新成功！用户现在拥有管理员权限:")
            print(f"   Role: admin")
            print(f"   Plan: enterprise")
            print(f"   Quota: 9999999")
            print("\n🔄 请刷新浏览器管理员页面验证")
        else:
            print("\n⚠️ 更新可能未生效，请检查 Supabase RLS 权限")
            
    except Exception as e:
        print(f"\n❌ 更新失败: {e}")
        print("可能原因：")
        print("  1. Supabase RLS 策略阻止了更新（需要用 service_role key）")
        print("  2. 网络连接问题")
        print("  3. 表结构不匹配")

if __name__ == "__main__":
    fix_admin_role()
