import { json } from "@sveltejs/kit";
import { GoogleGenAI } from "@google/genai";
const client = new GoogleGenAI({
  apiKey: process.env.GOOGLE_AI_API_KEY || ""
});
const POST = async ({ request }) => {
  try {
    const { image, prompt } = await request.json();
    if (!image || !prompt) {
      return json({ success: false, error: "Missing image or prompt" }, { status: 400 });
    }
    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
    const response = await client.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: base64Data
              }
            }
          ]
        }
      ],
      config: {
        temperature: 1,
        // Gemini 3 is optimized for temperature 1.0
        thinkingConfig: {
          thinkingLevel: "medium"
          // Visual validation needs moderate reasoning
        }
      }
    });
    const candidate = response.candidates?.[0];
    if (!candidate) {
      return json({ success: false, error: "No response from Gemini" });
    }
    let text = "";
    for (const part of candidate.content?.parts || []) {
      if ("text" in part && part.text) {
        text += part.text;
      }
    }
    return json({
      success: true,
      text,
      usage: response.usageMetadata ? {
        promptTokens: response.usageMetadata.promptTokenCount || 0,
        responseTokens: response.usageMetadata.candidatesTokenCount || 0,
        totalTokens: response.usageMetadata.totalTokenCount || 0
      } : void 0
    });
  } catch (error) {
    console.error("[Vision API] Error:", error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    }, { status: 500 });
  }
};
export {
  POST
};
