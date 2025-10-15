const request = require('supertest')
const dotenv = require('dotenv')

dotenv.config({ path: '../.env' })

const API_BASE_URL = process.env.API_BASE_URL;

const payload = {
    "name": "太郎",
    "furigana": "タロウ",
    "postal": "1234567",
    "address": "東京都渋谷区",
    "email": "taro@example.com",
    "pet": "dog",
    "agree": true,
    "question": "こんにちは"
}

describe('success', () => {
    test('郵便番号7桁', async () => {
        const response = await request(API_BASE_URL).post('/contact').send(
            payload
        )
        expect(response.body.isValid).toBe(true)        
    })
    test('郵便番号3桁-4桁', async () => {
        const response = await request(API_BASE_URL).post('/contact').send({
            ...payload,
            postal: "123-4567"
        })
        expect(response.body.isValid).toBe(true)        
    })
    test('質問が500文字', async () => {
        const response = await request(API_BASE_URL).post('/contact').send({
            ...payload,
            question: "あ".repeat(500)
        })
        expect(response.body.isValid).toBe(true)        
    })
})

describe('failure', () => {
    test('必須項目が未入力', async () => {
        const response = await request(API_BASE_URL).post('/contact').send({            
            "name": "",
            "furigana": "",
            "email": "",
            "pet": "",
            "agree": "",
        })
        expect(response.body.isValid).toBe(false);        
        expect(response.body.errors).toStrictEqual([
            {
                "field": "name",
                "message": "氏名は必須です。"
            },
            {
                "field": "furigana",
                "message": "フリガナは必須です。"
            },
            {
                "field": "email",
                "message": "メールアドレスは必須です。",
            },
            {
                "field": "pet",
                "message": "好きなペットを選択してください。",
            },
            {
                "field": "agree",
                "message": "同意が必須です。",
            },
        ])
    })
    test('フリガナにひらがな', async () => {
        const response = await request(API_BASE_URL).post('/contact').send({
            ...payload,
            "furigana": "たろう",
        })
        expect(response.body.isValid).toBe(false)
        expect(response.body.errors).toStrictEqual([
            {
                "field": "furigana",
                "message": "フリガナは全角カタカナで入力してください。",
            },
        ])
    })
    test('フリガナに半角カタカナ', async () => {
        const response = await request(API_BASE_URL).post('/contact').send({
            ...payload,
            "furigana": "ﾀﾛｳ",            
        })
        expect(response.body.isValid).toBe(false)
        expect(response.body.errors).toStrictEqual([
            {
                "field": "furigana",
                "message": "フリガナは全角カタカナで入力してください。",
            },
        ])
    })
    test('郵便番号が7桁でない', async () => {
        const response = await request(API_BASE_URL).post('/contact').send({
            ...payload,
            "postal": "12345678",
        })
        expect(response.body.isValid).toBe(false)
        expect(response.body.errors).toStrictEqual([
            {
                "field": "postal",
                "message": "郵便番号は7桁または3桁-4桁で入力してください。",
            },
        ])
    })
    test('郵便番号が3桁-4桁でない', async () => {
        const response = await request(API_BASE_URL).post('/contact').send({
            ...payload,
            "postal": "12-34567",            
        })
        expect(response.body.isValid).toBe(false)
        expect(response.body.errors).toStrictEqual([
            {
                "field": "postal",
                "message": "郵便番号は7桁または3桁-4桁で入力してください。",
            },
        ])
    })
    test('メールアドレスに無効な形式', async () => {
        const response = await request(API_BASE_URL).post('/contact').send({
            ...payload,            
            "email": "taro@example",
        })
        expect(response.body.isValid).toBe(false)
        expect(response.body.errors).toStrictEqual([
            {
                "field": "email",
                "message": "有効なメールアドレスを入力してください。",
            },
        ])
    })
    test('好きなペットが不正な値', async () => {
        const response = await request(API_BASE_URL).post('/contact').send({
            ...payload,
            "pet": "rabbit",            
        })
        expect(response.body.isValid).toBe(false)
        expect(response.body.errors).toStrictEqual([
            {
                "field": "pet",
                "message": "好きなペットを選択してください。",
            },
        ])
    })
    test('質問が501文字', async () => {
        const response = await request(API_BASE_URL).post('/contact').send({
            ...payload,
            "question": "あ".repeat(501)
        })
        expect(response.body.isValid).toBe(false)
        expect(response.body.errors).toStrictEqual([
            {
                "field": "question",
                "message": "質問は500文字以内で入力してください。",
            },
        ])
    })
    test('同意が未選択', async () => {
        const response = await request(API_BASE_URL).post('/contact').send({
            ...payload,
            "agree": "",
        })
        expect(response.body.isValid).toBe(false)
        expect(response.body.errors).toStrictEqual([
            {
                "field": "agree",
                "message": "同意が必須です。",
            },
        ])
    })
})