import { GoogleGenAI } from "@google/genai";
import { Product, Transaction } from "../types";

const apiKey = process.env.API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

export const generateBusinessInsights = async (
  transactions: Transaction[], 
  products: Product[]
): Promise<string> => {
  if (!apiKey) {
    return "API Key is missing. Please configure the environment variable.";
  }

  // Summarize data to avoid token limits
  const salesSummary = transactions.slice(0, 50).map(t => ({
    date: t.date,
    total: t.total,
    items: t.items.map(i => `${i.name} (x${i.quantity})`).join(', ')
  }));

  const stockSummary = products.map(p => ({
    name: p.name,
    stock: p.stock
  }));

  const prompt = `
    Analyze the following sales and inventory data for a retail store.
    
    Sales History (Last 50):
    ${JSON.stringify(salesSummary)}

    Current Inventory Status:
    ${JSON.stringify(stockSummary)}

    Please provide a concise business insight report including:
    1. Best selling items.
    2. Low stock warnings.
    3. Revenue trends.
    4. Suggestions for restocking or promotions.
    
    Format the output as simple HTML (using <h3>, <ul>, <li>, <p> tags) suitable for display in a dashboard card. Do not use Markdown backticks.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    return response.text || "No insights generated.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "Failed to generate insights at this time.";
  }
};

export const suggestProductDescription = async (name: string, category: string): Promise<string> => {
   if (!apiKey) return "No API Key";

   try {
     const response = await ai.models.generateContent({
       model: 'gemini-3-flash-preview',
       contents: `Write a short, catchy, 2-sentence marketing description for a product named "${name}" in the category "${category}".`,
     });
     return response.text || "";
   } catch (error) {
     return "";
   }
};