"""Run multiple models interactively without saving API keys."""

import getpass
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

from lab import cli
from providers import ENDPOINTS


def main():
    if not sys.stdin.isatty():
        raise SystemExit('请在本机终端运行此命令，密钥输入时不会显示。')
    profiles = [{'name': 'baseline', 'provider': 'mock', 'model': '固定模拟结果'}]
    print('模型接口可选 openai、anthropic、gemini、compatible。直接回车开始测试。')
    while provider := input('模型接口：').strip().lower():
        if provider not in ENDPOINTS:
            print('请选择列出的接口。')
            continue
        model = input('模型 ID：').strip()
        if not model:
            print('请输入模型 ID。')
            continue
        env = f'AUDIT_LAB_KEY_{len(profiles)}'
        profile = {'name': f'{provider}-{len(profiles)}', 'provider': provider, 'model': model, 'key_env': env}
        if provider == 'compatible':
            profile['base_url'] = input('API 基础网址（通常到 /v1）：').strip()
        os.environ[env] = getpass.getpass('API Key（本机免密服务可留空）：').strip()
        profiles.append(profile)
    with TemporaryDirectory(prefix='audit-workpaper-lab-') as directory:
        config = Path(directory) / 'models.json'
        config.write_text(json.dumps(profiles), encoding='utf-8')
        sys.argv = ['lab.py', '--models', str(config)]
        return cli()


if __name__ == '__main__':
    raise SystemExit(main())
