# 数据形态参考

## URI

### Snapshot 对象

```json
[
    [
        {
            "id": "162da440-98dc-4e00-8433-9c3f38450378",
            "createdAt": "2026-06-09T22:54:27.822Z",
            "pinned": true,
            "name": "测测",
            "description": "就是先测测",
            "checkedUris": [
                "file:///d%3A/vscode-extensions/test-projects/context.js",
                "file:///d%3A/vscode-extensions/test-projects/basicUsage.py",
                "file:///d%3A/vscode-extensions/test-projects/test.js",
                "file:///d%3A/vscode-extensions/test-projects/jsconfig.json",
                "file:///d%3A/vscode-extensions/test-projects/fileSelector.js"
            ]
        }
    ],
    [
        {
            "id": "dd085e5e-b593-4e05-b083-3de2943cfb2b",
            "createdAt": "2026-06-08T15:43:50.464Z",
            "pinned": false,
            "name": "jj",
            "description": "",
            "checkedUris": [
                "file:///d%3A/vscode-extensions/test-projects/test.js",
                "file:///d%3A/vscode-extensions/test-projects/parent_one",
                "file:///d%3A/vscode-extensions/test-projects/utils",
                "file:///d%3A/vscode-extensions/test-projects/basicUsage.py"
            ]
        }
    ]
]
```

### 内存树

Map 对象结构

```JSON
{
    "file:///d%3A/vscode-extensions/test-projects/parent_one": [
        [
            "branch_one",
            2
        ],
        [
            "parent_two",
            2
        ]
    ],
    "file:///d%3A/vscode-extensions/test-projects/src/utils": [
        [
            "utils",
            2
        ],
        [
            "workspace.js",
            1
        ]
    ]
}
```
