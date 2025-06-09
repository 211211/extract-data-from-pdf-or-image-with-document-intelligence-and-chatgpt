During my time working at MODEC, I'm writing this example to show off abilities of document intelligence and chatgpt using to extract data from given pdf/image file, post-processing with gpt.

The flow should be:

1. User to upload pdf/image file via a form
2. Making a call to API: `/api/v1/pdf-extractor`
3. Calling Document Intelligence to extract the text. Ref: `src/core/public/pdf-extractor/pdf-extractor.service.ts`
4. Get the response from step 3 and make call to chat gpt with pre-defined prompt `src/core/public/pdf-extractor/prompt.ts`
5. Expect to get the response as following from GPT (gpt-4o model)

```
[
  {
    "biomarker_name": "MPV",
    "biomarker_value": "9",
    "unit": "NA",
    "reference_range": "9.00 -13 .00",
    "category": "Hematology"
  }
]
```

I put sample pdf/image file in `/sample`.

## Environment

Clone `.env` from `.env.example` and to fill-in all required variables
```bash
$ cp .env.example .env
```
- Important note: If you use OpenAI, not Azure OpenAI, please fill-in `OPENAI_API_KEY` in .env file and to adjust the import in `src/core/public/pdf-extractor/pdf-extractor.module.ts` from `AzureOpenAIInstance` to `OpenAIInstance`


## Dependencies installation

```bash
$ npm install -g yarn
$ yarn install
```

## Running the app

```bash
# watch mode
$ yarn start:dev

# development
$ yarn start

# production
$ yarn build
```

## How to test
Making an HTTP POST method to `/api/v1/pdf-extractor` API
```bash
curl --location 'localhost:8083/api/v1/pdf-extractor' \
--form 'file=@"/your/path/to/sample.pdf"'
```

## License

MIT
