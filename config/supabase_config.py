import json
import os
from pathlib import Path
from cryptography.fernet import Fernet

CONFIG_PATH = Path(__file__).with_name('supabase_config.json')


def _get_or_create_key() -> str:
    key = os.environ.get('SUPABASE_DB_KEY')
    if key:
        return key
    key = Fernet.generate_key().decode()
    os.environ['SUPABASE_DB_KEY'] = key
    return key


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        raise FileNotFoundError(CONFIG_PATH)
    with CONFIG_PATH.open('r', encoding='utf-8') as fh:
        return json.load(fh)


def save_config(config: dict) -> None:
    with CONFIG_PATH.open('w', encoding='utf-8') as fh:
        json.dump(config, fh, indent=2)


def encrypt_password(password: str) -> tuple[str, str]:
    key = _get_or_create_key()
    f = Fernet(key.encode())
    token = f.encrypt(password.encode()).decode()
    return token, key


def decrypt_password(token: str, key: str) -> str:
    f = Fernet(key.encode())
    return f.decrypt(token.encode()).decode()


def set_password(password: str) -> None:
    token, key = encrypt_password(password)
    config = load_config()
    config['password_encrypted'] = token
    config['password_key'] = key
    save_config(config)


def get_connection_string() -> str:
    config = load_config()
    password = decrypt_password(config['password_encrypted'], config['password_key'])
    return (
        f"postgresql://{config['user']}:{password}@{config['host']}:{config['port']}/{config['database']}"
    )
