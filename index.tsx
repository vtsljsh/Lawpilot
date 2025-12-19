
import React, { useState, useRef, useEffect, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Modality } from '@google/genai';
import { 
  Scale, 
  Search,
  Clock,
  FileText,
  Trash2,
  Paperclip,
  Send,
  X,
  Globe,
  Mic,
  MicOff,
  Copy,
  ExternalLink,
  Download,
  ListFilter,
  Loader2,
  History,
  Plus,
  Printer,
  ZoomIn,
  ZoomOut,
  ListTodo,
  Sparkles,
  AudioWaveform,
  FileImage,
  ChevronLeft,
  ChevronRight,
  Menu,
  Library,
  BookOpenText,
  AlertTriangle
} from 'lucide-react';

// --- Types ---
interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  fileName?: string;
  fileURL?: string;
  fileStatus?: 'Analyzing...' | 'Ready for Review' | 'Error' | 'Processing...';
}

interface Citation {
  web?: {
    uri?: string;
    title?: string;
  };
  text?: string;
}

interface Task {
  id: string;
  text: string;
  deadline: string;
  isComplete: boolean;
}

interface ManagedDoc {
  id: string;
  name: string;
  url: string;
  type: string;
  date: string;
  tasks: Task[];
  file: File | null; // Store the file object for analysis
}

interface Session {
  id: string;
  title: string;
  date: string;
  messages: Message[];
  citations: Citation[];
}

// --- Audio Helpers ---
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}


// --- File Helper ---
const fileToGenerativePart = async (file: File) => {
  const base64EncodedDataPromise = new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.readAsDataURL(file);
  });
  return {
    inlineData: { data: await base64EncodedDataPromise, mimeType: file.type },
  };
};

const JurisApp = () => {
  const [activeTab, setActiveTab] = useState<'research' | 'documents' | 'history'>('research');
  const [messages, setMessages] = useState<Message[]>([]);
  const [userInput, setUserInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [showAllSources, setShowAllSources] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loadingMessage, setLoadingMessage] = useState('Juris is thinking...');
  const [isListening, setIsListening] = useState(false);
  const [isConfigured, setIsConfigured] = useState(true);
  
  // Data Persistence
  const [managedDocs, setManagedDocs] = useState<ManagedDoc[]>([]);
  const [sessionHistory, setSessionHistory] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  // Document Vault State
  const [docSearchTerm, setDocSearchTerm] = useState('');
  const [isUploadingDocs, setIsUploadingDocs] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [viewingDoc, setViewingDoc] = useState<ManagedDoc | null>(null);
  const [managingTasksForDoc, setManagingTasksForDoc] = useState<ManagedDoc | null>(null);
  const [analyzingDoc, setAnalyzingDoc] = useState<ManagedDoc | null>(null);
  const [analysisPrompt, setAnalysisPrompt] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState('');
  const [newTaskText, setNewTaskText] = useState('');
  const [newTaskDeadline, setNewTaskDeadline] = useState('');
  const [summarizingDoc, setSummarizingDoc] = useState<ManagedDoc | null>(null);
  const [summaryResult, setSummaryResult] = useState('');
  const [isSummarizing, setIsSummarizing] = useState(false);

  // Audio State
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // UI State
  const [isCitationRailVisible, setIsCitationRailVisible] = useState(true);
  const [isMobileNavVisible, setIsMobileNavVisible] = useState(false);
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docUploadInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);
  const docViewerFrameRef = useRef<HTMLIFrameElement>(null);

  // --- Initial Setup ---
  useEffect(() => {
    setTimeout(() => {
      if (!(window as any).GEMINI_API_KEY) {
        console.error("Configuration Error: GEMINI_API_KEY not found in window object.");
        setIsConfigured(false);
      }
    }, 500);

    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

    const savedDocs = localStorage.getItem('juris_docs');
    const savedHistory = localStorage.getItem('juris_history');
    if (savedDocs) {
        const parsedDocs = JSON.parse(savedDocs);
        setManagedDocs(parsedDocs.map((d: any) => ({...d, file: null})));
    }
    if (savedHistory) setSessionHistory(JSON.parse(savedHistory));
  }, []);

  useEffect(() => {
    const docsToSave = managedDocs.map(({ file, ...rest }) => rest);
    localStorage.setItem('juris_docs', JSON.stringify(docsToSave));
  }, [managedDocs]);

  useEffect(() => {
    localStorage.setItem('juris_history', JSON.stringify(sessionHistory));
  }, [sessionHistory]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [userInput]);

  // Speech Recognition Init
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.onresult = (event: any) => {
        const transcript = Array.from(event.results).map((result: any) => result[0].transcript).join('');
        setUserInput(transcript);
      };
      recognitionRef.current.onend = () => setIsListening(false);
    }
  }, []);

  // --- Handlers ---
  const prepareForApiCall = () => {
    const apiKey = (window as any).GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error("API key not found. Please ensure it's set correctly in your environment.");
    }
    return new GoogleGenAI({ apiKey });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const verifiedCitations = useMemo(() => citations.filter(c => !!c.web), [citations]);
  const displayedCitations = showAllSources ? citations : verifiedCitations;

  const toggleListening = () => {
    if (isListening) recognitionRef.current?.stop();
    else {
      setUserInput('');
      recognitionRef.current?.start();
      setIsListening(true);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) setSelectedFile(e.target.files[0]);
  };

  const handleMultiFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = e.target.files;
      setIsUploadingDocs(true);
      setUploadProgress(0);

      const newManagedDocs: ManagedDoc[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileURL = URL.createObjectURL(file);
        newManagedDocs.push({
          id: Math.random().toString(36).substr(2, 9),
          name: file.name,
          url: fileURL,
          type: file.type,
          date: new Date().toLocaleDateString(),
          tasks: [],
          file: file,
        });
        
        setUploadProgress(Math.round(((i + 1) / files.length) * 100));
        await new Promise(r => setTimeout(r, 200));
      }
      
      setManagedDocs(prev => [...prev, ...newManagedDocs]);
      setTimeout(() => setIsUploadingDocs(false), 500);
    }
  };

  const startNewSession = () => {
    setMessages([]);
    setCitations([]);
    setCurrentSessionId(null);
    setActiveTab('research');
    setIsMobileNavVisible(false);
  };

  const handleClearChat = () => {
    if (window.confirm("Are you sure you want to clear this entire conversation? This cannot be undone.")) {
      setMessages([]);
      setCitations([]);
      setCurrentSessionId(null);
    }
  };

  const loadSession = (session: Session) => {
    setMessages(session.messages);
    setCitations(session.citations);
    setCurrentSessionId(session.id);
    setActiveTab('research');
    setIsMobileNavVisible(false);
  };

  const deleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm("Delete this session from history?")) {
      setSessionHistory(prev => prev.filter(s => s.id !== id));
      if (currentSessionId === id) startNewSession();
    }
  };

  const handleTextToSpeech = async (message: Message) => {
    if (playingAudioId === message.id) {
        audioSourceRef.current?.stop();
        setPlayingAudioId(null);
        return;
    }
    
    try {
        const ai = prepareForApiCall();
        setPlayingAudioId(message.id);
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: message.text }] }],
            config: { responseModalities: [Modality.AUDIO] },
        });

        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (base64Audio && audioContextRef.current) {
            const audioBuffer = await decodeAudioData(decode(base64Audio), audioContextRef.current, 24000, 1);
            const source = audioContextRef.current.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContextRef.current.destination);
            source.start();
            source.onended = () => setPlayingAudioId(null);
            audioSourceRef.current = source;
        }
    } catch (error) {
        console.error("TTS Error:", error);
        setPlayingAudioId(null);
    }
  };

  const handleSummarizeDocument = async (doc: ManagedDoc) => {
      if (!doc.file) {
        alert("File data is not available for summarization. Please re-upload the document.");
        return;
      }
      
      try {
        const ai = prepareForApiCall();
        setSummarizingDoc(doc);
        setIsSummarizing(true);
        setSummaryResult('');

        const parts = [
          { text: `You are a legal expert. Provide a concise, professional summary of the following document: "${doc.name}". Focus on the key legal points, arguments, and outcomes.` },
          await fileToGenerativePart(doc.file)
        ];
        const response = await ai.models.generateContent({
          model: "gemini-3-pro-preview",
          contents: { parts }
        });
        setSummaryResult(response.text || 'No summary could be generated.');
      } catch (error) {
        console.error("Summarization error:", error);
        setSummaryResult("An error occurred while generating the summary.");
      } finally {
        setIsSummarizing(false);
      }
    };
  
  const handleAnalyzeDocument = async () => {
    if (!analysisPrompt || !analyzingDoc?.file) return;

    try {
        const ai = prepareForApiCall();
        setIsAnalyzing(true);
        setAnalysisResult('');
        const parts = [
            { text: `Context: You are analyzing a legal document named "${analyzingDoc.name}". Task: ${analysisPrompt}` },
            await fileToGenerativePart(analyzingDoc.file)
        ];
        const response = await ai.models.generateContent({
            model: "gemini-3-pro-preview",
            contents: { parts }
        });
        setAnalysisResult(response.text || 'No result found.');
    } catch (error) {
        console.error("Analysis error:", error);
        setAnalysisResult("An error occurred during analysis.");
    } finally {
        setIsAnalyzing(false);
    }
  };

  const handleAddTask = (docId: string) => {
    if (!newTaskText) return;
    const newTask: Task = {
        id: Math.random().toString(36).substr(2, 9),
        text: newTaskText,
        deadline: newTaskDeadline,
        isComplete: false,
    };
    // FIX: Spread the tasks array from the document, not the document itself.
    setManagedDocs(docs => docs.map(d => d.id === docId ? {...d, tasks: [...d.tasks, newTask]} : d));
    setNewTaskText('');
    setNewTaskDeadline('');
  };

  const toggleTask = (docId: string, taskId: string) => {
    setManagedDocs(docs => docs.map(d => d.id === docId ? { ...d, tasks: d.tasks.map(t => t.id === taskId ? {...t, isComplete: !t.isComplete} : t) } : d));
  };

  const deleteTask = (docId: string, taskId: string) => {
    setManagedDocs(docs => docs.map(d => d.id === docId ? { ...d, tasks: d.tasks.filter(t => t.id !== taskId) } : d));
  };
  
  const handlePrintDoc = () => {
    if (docViewerFrameRef.current?.contentWindow) {
      docViewerFrameRef.current.contentWindow.focus();
      docViewerFrameRef.current.contentWindow.print();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!userInput.trim() && !selectedFile) || isLoading) return;
    
    let ai;
    try {
        ai = prepareForApiCall();
    } catch (error) {
        // This should not be reached if isConfigured state is handled correctly, but it's a good safeguard.
        console.error(error);
        setIsConfigured(false);
        return;
    }
    
    if (isListening) recognitionRef.current?.stop();

    const currentInput = userInput;
    const currentFile = selectedFile;
    let fileURL = '';

    if (currentFile) fileURL = URL.createObjectURL(currentFile);
    
    const userMessage: Message = { 
        id: Math.random().toString(36).substr(2, 9),
        role: 'user', 
        text: currentInput,
        fileName: currentFile?.name,
        fileURL: fileURL || undefined,
        fileStatus: currentFile ? 'Analyzing...' : undefined
    };
    
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setIsLoading(true);
    setUserInput('');
    setSelectedFile(null);

    try {
        const parts = [];
        if (currentInput) parts.push({ text: currentInput });
        if (currentFile) parts.push(await fileToGenerativePart(currentFile));

        const isImageAnalysis = currentFile?.type.startsWith('image/');
        const modelName = isImageAnalysis ? "gemini-3-pro-preview" : "gemini-3-flash-preview";
        const systemInstruction = isImageAnalysis 
            ? "You are an expert legal assistant analyzing visual evidence. Describe the image and identify legally relevant objects, actions, or context. Be objective and precise."
            : "You are Juris, a high-trust expert Indian AI Law Consultant. Your tone is authoritative, professional, and precise. Always cite sources from Indian statutes and case law. Provide source summaries when relevant.";

        const response = await ai.models.generateContent({
            model: modelName,
            contents: { parts },
            config: {
                systemInstruction,
                tools: isImageAnalysis ? [] : [{ googleSearch: {} }],
            },
        });

      const modelMessage: Message = { id: Math.random().toString(36).substr(2, 9), role: 'model', text: response.text || '' };
      const finalMessages = [...newMessages, modelMessage];
      setMessages(finalMessages);

      const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      setCitations(groundingChunks);

      const sessionTitle = currentInput ? currentInput.substring(0, 40) + '...' : (currentFile?.name || 'Legal Consultation');
      const updatedSession: Session = {
        id: currentSessionId || Math.random().toString(36).substr(2, 9),
        title: sessionTitle,
        date: new Date().toLocaleString(),
        messages: finalMessages,
        citations: groundingChunks
      };

      if (currentSessionId) {
        setSessionHistory(prev => prev.map(s => s.id === currentSessionId ? updatedSession : s));
      } else {
        setSessionHistory(prev => [updatedSession, ...prev]);
        setCurrentSessionId(updatedSession.id);
      }
      setMessages(prev => prev.map(m => m.id === userMessage.id ? { ...m, fileStatus: 'Ready for Review' } : m));

    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { id: Math.random().toString(36).substr(2, 9), role: 'model', text: "An error occurred. This could be due to an invalid API key or a network issue. Please check your key in the settings and try again." }]);
      setMessages(prev => prev.map(m => m.id === userMessage.id ? { ...m, fileStatus: 'Error' } : m));
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleTabClick = (tab: 'research' | 'documents' | 'history') => {
    setActiveTab(tab);
    setIsMobileNavVisible(false);
  }

  const filteredDocs = useMemo(() => managedDocs.filter(doc => doc.name.toLowerCase().includes(docSearchTerm.toLowerCase())), [managedDocs, docSearchTerm]);

  return (
    <div className="juris-container">
      <style>{`
        /* --- Main App Styles --- */
        .juris-container { display: flex; height: 100vh; width: 100vw; background-color: var(--bg-light); color: var(--text-main); position: relative; overflow: hidden; }
        
        .sidebar { width: 280px; background: linear-gradient(180deg, #2c3e50 0%, #34495e 100%); color: #ECF0F1; display: flex; flex-direction: column; flex-shrink: 0; box-shadow: var(--shadow-md); z-index: 100;}
        .logo-section { padding: 2rem 1.5rem; border-bottom: 1px solid rgba(212, 175, 55, 0.2); }
        .logo-placeholder { display: flex; align-items: center; gap: 0.75rem; }
        .logo-symbol { font-size: 2rem; background: linear-gradient(45deg, var(--brand-gold), #FFF); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-family: var(--font-serif); }
        .logo-brand { font-family: var(--font-serif); font-weight: 700; letter-spacing: 0.05em; font-size: 1.4rem; color: white; }
        
        .nav-list { flex: 1; padding: 1.5rem 1rem; }
        .nav-link { display: flex; align-items: center; gap: 0.75rem; padding: 0.85rem 1rem; border-radius: 0.5rem; color: #BDC3C7; transition: 0.2s; cursor: pointer; margin-bottom: 0.5rem; font-size: 0.95rem; }
        .nav-link:hover { background: #34495e; color: white; }
        .nav-link.active { background: var(--brand-gold); color: var(--brand-navy); font-weight: 600; box-shadow: 0 4px 12px rgba(212, 175, 55, 0.3); }

        .sidebar-actions { padding: 0 1rem 1.5rem; }
        .clear-btn { width: 100%; display: flex; align-items: center; gap: 0.5rem; padding: 0.75rem 1rem; border-radius: 0.5rem; color: #FC8181; border: 1px solid rgba(252, 129, 129, 0.2); background: transparent; cursor: pointer; transition: 0.2s; font-size: 0.9rem; margin-top: 0.5rem; }
        .clear-btn:hover { background: rgba(252, 129, 129, 0.1); border-color: #FC8181; }

        .new-chat-btn { margin: 1.5rem; border: 1px solid var(--brand-gold); color: var(--brand-gold); padding: 0.75rem; border-radius: 0.5rem; text-align: center; display: flex; align-items: center; justify-content: center; gap: 0.5rem; cursor: pointer; transition: 0.2s; font-weight: 600; font-size: 0.9rem; background: transparent; }
        .new-chat-btn:hover { background: rgba(212, 175, 55, 0.1); }

        .main-content { flex: 1; display: flex; flex-direction: column; overflow: hidden; position: relative; }
        .view-header { height: 4.5rem; background: rgba(255,255,255,0.8); backdrop-filter: blur(8px); border-bottom: 1px solid var(--border-color); display: flex; align-items: center; justify-content: space-between; padding: 0 2rem; z-index: 5; }
        .view-header h2 { font-family: var(--font-serif); font-size: 1.25rem; color: var(--brand-navy); margin: 0; }

        .chat-area { flex: 1; overflow-y: auto; padding: 2.5rem 2rem; background: linear-gradient(to bottom, #F8F9FA, #FFFFFF); }
        .msg-wrap { max-width: 52rem; margin: 0 auto 2.5rem; display: flex; gap: 1.25rem; }
        .msg-wrap.user { flex-direction: row-reverse; }
        .avatar { width: 2.5rem; height: 2.5rem; border-radius: 0.5rem; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .avatar.model { background: white; color: var(--brand-navy); border: 1px solid var(--border-color); }
        .avatar.user { background: var(--brand-gold); color: var(--brand-navy); font-weight: 700; font-size: 0.8rem; }
        .bubble { padding: 1.25rem 1.5rem; border-radius: 0.75rem; font-size: 0.95rem; line-height: 1.6; position: relative; max-width: 85%; }
        .user .bubble { background: var(--brand-navy); color: var(--text-light); border-top-right-radius: 0; box-shadow: var(--shadow-md); }
        .model .bubble { background: var(--bg-main); border: 1px solid var(--border-color); border-top-left-radius: 0; box-shadow: var(--shadow-sm); }
        
        .input-bar { padding: 1.5rem 2rem; background: rgba(255,255,255,0.7); backdrop-filter: blur(10px); border-top: 1px solid var(--border-color); }
        .input-box-wrapper { max-width: 52rem; margin: 0 auto; position: relative; }
        .input-textarea { width: 100%; border: 1px solid var(--border-color); border-radius: 1rem; padding: 1rem 7.5rem 1rem 1.25rem; font-size: 1rem; outline: none; transition: 0.2s; resize: none; min-height: 60px; }
        .input-textarea:focus { border-color: var(--brand-gold); box-shadow: 0 0 0 4px rgba(212, 175, 55, 0.1); }
        .input-textarea:disabled { background: #F8F9FA; cursor: not-allowed; }
        
        .input-actions { position: absolute; right: 0.75rem; top: 0.75rem; display: flex; gap: 0.5rem; }
        .action-btn { padding: 0.6rem; border-radius: 0.75rem; background: transparent; border: none; cursor: pointer; color: var(--text-muted); transition: 0.2s; display: flex; align-items: center; justify-content: center; }
        .action-btn:hover { color: var(--brand-navy); background: #F0F2F5; }
        .action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .action-btn.active-mic { color: white; background: #E53E3E; animation: mic-pulse 1.5s infinite; }
        @keyframes mic-pulse { 0% { box-shadow: 0 0 0 0 rgba(229, 62, 62, 0.4); } 70% { box-shadow: 0 0 0 10px rgba(229, 62, 62, 0); } 100% { box-shadow: 0 0 0 0 rgba(229, 62, 62, 0); } }

        .send-btn { background: var(--brand-navy); color: white; border-radius: 0.75rem; padding: 0.6rem 0.8rem; border: none; cursor: pointer; transition: 0.2s; }
        .send-btn:hover { background: #000; transform: translateY(-1px); }
        
        .config-error-bar { padding: 1rem 2rem; background: #FFF5F5; border-top: 1px solid #FED7D7; }
        .config-error-content { max-width: 52rem; margin: 0 auto; display: flex; align-items: center; gap: 1rem; color: #C53030; font-size: 0.9rem; }
        .config-error-content strong { color: #9B2C2C; }

        .right-rail { width: 340px; border-left: 1px solid var(--border-color); background: var(--bg-main); display: flex; flex-direction: column; flex-shrink: 0; transition: margin-right 0.3s ease-in-out, transform 0.3s ease-in-out; }
        .right-rail.hidden { margin-right: -340px; }
        .rail-toggle-btn { position: fixed; top: 50%; right: 340px; transform: translate(50%, -50%); z-index: 20; background: white; border: 1px solid var(--border-color); width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: var(--shadow-sm); color: var(--text-muted); transition: right 0.3s ease-in-out, opacity 0.3s; }
        .rail-toggle-btn:hover { color: var(--brand-navy); border-color: var(--brand-gold); }
        .rail-toggle-btn.hidden { right: 0px; }

        .rail-header { padding: 1.5rem; border-bottom: 1px solid var(--border-color); font-weight: 700; font-family: var(--font-serif); font-size: 1.1rem; color: var(--brand-navy); }
        .citation-list { flex: 1; overflow-y: auto; padding: 1.5rem; }
        .citation-card { padding: 1rem; border: 1px solid var(--border-color); border-radius: 0.75rem; margin-bottom: 1rem; transition: 0.2s; background: white; }
        .citation-card:hover { border-color: var(--brand-gold); box-shadow: var(--shadow-sm); transform: translateY(-2px); }
        .card-title { font-size: 0.85rem; font-weight: 700; margin-bottom: 0.5rem; color: var(--brand-navy); display: flex; align-items: flex-start; gap: 0.5rem; }
        
        .history-item { padding: 1.25rem; border: 1px solid var(--border-color); background: white; border-radius: 0.75rem; margin-bottom: 1rem; cursor: pointer; transition: 0.2s; position: relative; }
        .history-item:hover { border-color: var(--brand-gold); background: #FFFDF9; box-shadow: var(--shadow-sm); }
        
        .link-style { color: var(--brand-gold); text-decoration: none; font-weight: 600; }
        .link-style:hover { text-decoration: underline; }

        .mobile-nav-toggle, .mobile-citations-toggle { display: none; }
        .mobile-overlay { display: none; }

        /* --- Additional Styles --- */
        .header-actions { display: flex; align-items: center; gap: 1rem; }
        .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; backdrop-filter: blur(4px); }
        .modal-content { background: white; border-radius: 0.75rem; box-shadow: var(--shadow-md); max-height: 90vh; overflow-y: auto; }
        .modal-header { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.5rem; border-bottom: 1px solid var(--border-color); }
        .modal-header h3 { margin: 0; font-family: var(--font-serif); color: var(--brand-navy); }
        .close-modal { background: none; border: none; cursor: pointer; padding: 0.5rem; color: var(--text-muted); }
        .file-status-pill { display: inline-flex; align-items: center; gap: 0.5rem; background: #F0F2F5; border-radius: 1rem; padding: 0.25rem 0.75rem; font-size: 0.75rem; margin-top: 0.75rem; }
        .tts-button { position: absolute; bottom: 0.5rem; right: 0.5rem; background: #F0F2F5; border: none; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--text-muted); }
        .tts-button:hover { background: #E2E8F0; }
        .tts-button .playing { color: var(--brand-accent); }
        .vault-container { padding: 2rem; overflow-y: auto; flex: 1; }
        .vault-actions { display: flex; gap: 1rem; margin-bottom: 1.5rem; }
        .search-input { width: 100%; border: 1px solid var(--border-color); border-radius: 0.5rem; padding: 0.75rem 1rem 0.75rem 2.5rem; font-size: 0.9rem; }
        .upload-indicator { margin-bottom: 1.5rem; }
        .progress-bar { width: 100%; background: #E2E8F0; border-radius: 4px; height: 8px; overflow: hidden; }
        .progress-fill { width: 0%; height: 100%; background: var(--brand-accent); transition: width 0.3s; }
        .doc-list-grid { display: grid; gap: 1rem; }
        .doc-item { display: flex; align-items: center; justify-content: space-between; background: white; padding: 1rem; border: 1px solid var(--border-color); border-radius: 0.5rem; }
        .task-badge { position: absolute; top: -4px; right: -4px; background: #E53E3E; color: white; border-radius: 50%; width: 16px; height: 16px; font-size: 10px; display: flex; align-items: center; justify-content: center; font-weight: bold; }
        .delete-btn { position: absolute; right: 1rem; top: 50%; transform: translateY(-50%); color: #A0AEC0; }
        .delete-btn:hover { color: #E53E3E; }
        .citation-meta { font-size: 0.7rem; color: #718096; word-break: break-all; margin-bottom: 0.5rem; }
        .citation-actions { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
        .cite-action-btn { background: none; border: 1px solid var(--border-color); color: #4A5568; font-size: 0.7rem; padding: 0.25rem 0.5rem; border-radius: 4px; cursor: pointer; display: flex; align-items: center; gap: 0.25rem; text-decoration: none; }
        .doc-viewer { display: flex; flex-direction: column; width: 80vw; max-width: 1200px; height: 90vh; }
        .viewer-controls { display: flex; gap: 0.5rem; }
        .viewer-controls button { background: #F0F2F5; border: none; padding: 0.5rem; border-radius: 4px; cursor: pointer; }
        .doc-viewer iframe { flex: 1; border: none; }
        .task-manager { padding: 1.5rem; }
        .task-list { max-height: 40vh; overflow-y: auto; margin-bottom: 1rem; }
        .task-item { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem; border-bottom: 1px solid var(--border-color); }
        .task-item.complete p { text-decoration: line-through; color: #A0AEC0; }
        .task-details { flex: 1; }
        .task-details p { margin: 0; font-size: 0.9rem; }
        .task-details small { color: #718096; }
        .delete-task { color: #A0AEC0; background: none; border: none; cursor: pointer; }
        .add-task-form { display: flex; gap: 0.5rem; }
        .add-task-form input { flex: 1; padding: 0.5rem; border: 1px solid var(--border-color); border-radius: 4px; }
        .add-task-form button { background: var(--brand-navy); color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; }
        .analysis-manager { padding: 1.5rem; }
        .analysis-manager textarea { width: 100%; padding: 0.5rem; border: 1px solid var(--border-color); border-radius: 4px; margin-bottom: 1rem; }
        .analysis-manager button { background: var(--brand-navy); color: white; border: none; padding: 0.75rem 1rem; border-radius: 4px; cursor: pointer; width: 100%; display: flex; align-items: center; justify-content: center; gap: 0.5rem; }
        .analysis-result { margin-top: 1.5rem; }
        .animate-spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        /* --- Mobile Responsive Styles --- */
        @media (max-width: 768px) {
            .sidebar { position: fixed; top: 0; left: 0; height: 100%; transform: translateX(-100%); transition: transform 0.3s ease-in-out; }
            .sidebar.mobile-visible { transform: translateX(0); }
            
            .right-rail { position: fixed; top: 0; right: 0; height: 100%; width: 300px; transform: translateX(100%); z-index: 100; border-left: none; box-shadow: var(--shadow-md); margin-right: 0 !important; }
            .right-rail.hidden { transform: translateX(100%); }
            .right-rail.mobile-visible { transform: translateX(0); }
            
            .rail-toggle-btn { display: none; }

            .view-header { padding: 0 1rem; }
            .view-header h2 { font-size: 1.1rem; }
            .mobile-nav-toggle, .mobile-citations-toggle { display: block; background: none; border: none; cursor: pointer; color: var(--brand-navy); padding: 0.5rem; }

            .header-actions { display: none; } /* Hide desktop AI Engine text */
            .main-content { transition: filter 0.3s ease-in-out; }

            .mobile-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.4); z-index: 99; display: block; }

            .chat-area { padding: 1.5rem 1rem; }
            .bubble { max-width: 90%; font-size: 0.9rem; }
            .input-bar { padding: 1rem; }
            .input-textarea { padding-right: 6.5rem; }
            
            .modal-content { width: calc(100vw - 2rem); max-height: calc(100vh - 2rem); }
            .doc-viewer { width: 100vw; height: 100vh; max-width: 100%; max-height: 100%; border-radius: 0; }
        }
      `}</style>
      
      {(isMobileNavVisible || (isCitationRailVisible && window.innerWidth <= 768)) && <div className="mobile-overlay" onClick={() => { setIsMobileNavVisible(false); setIsCitationRailVisible(false); }}></div>}

      {/* SIDEBAR */}
      <aside className={`sidebar ${isMobileNavVisible ? 'mobile-visible' : ''}`}>
        <div className="logo-section" onClick={startNewSession} style={{cursor: 'pointer'}}>
          <div className="logo-placeholder">
            <span className="logo-symbol">⚜</span>
            <span className="logo-brand">JURIS</span>
          </div>
        </div>
        
        <div className="new-chat-btn" onClick={startNewSession}>
          <Plus size={18} /> New Research Session
        </div>

        <nav className="nav-list">
          <div className={`nav-link ${activeTab === 'research' ? 'active' : ''}`} onClick={() => handleTabClick('research')}>
            <Search size={20} /> Legal Research
          </div>
          <div className={`nav-link ${activeTab === 'documents' ? 'active' : ''}`} onClick={() => handleTabClick('documents')}>
            <FileText size={20} /> Document Vault
          </div>
          <div className={`nav-link ${activeTab === 'history' ? 'active' : ''}`} onClick={() => handleTabClick('history')}>
            <History size={20} /> Research History
          </div>
        </nav>

        <div className="sidebar-actions">
          <button className="clear-btn" onClick={handleClearChat}>
            <Trash2 size={18} /> Clear Conversation
          </button>
        </div>

        <div style={{padding: '1.5rem', borderTop: '1px solid rgba(212, 175, 55, 0.2)'}}>
          <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
              <div style={{display: 'flex', alignItems: 'center', gap: '0.75rem'}}>
                <div style={{width: '2.5rem', height: '2.5rem', borderRadius: '4px', background: 'var(--brand-gold)', color: 'var(--brand-navy)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '0.9rem'}}>LP</div>
                <div>
                  <div style={{fontSize: '0.85rem', fontWeight: 600}}>Legal Professional</div>
                  <div style={{fontSize: '0.7rem', color: '#BDC3C7'}}>AI-Powered Consultant</div>
                </div>
              </div>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main className="main-content">
        <header className="view-header">
           <button className="mobile-nav-toggle" onClick={() => setIsMobileNavVisible(true)}><Menu size={24} /></button>
          <h2>
            {activeTab === 'research' && 'Legal Analysis'}
            {activeTab === 'documents' && 'Document Management'}
            {activeTab === 'history' && 'Archived Research'}
          </h2>
          <div className="header-actions">
            <div style={{fontSize: '0.75rem', color: 'var(--brand-accent)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
              <div style={{width: 8, height: 8, borderRadius: '50%', background: 'var(--brand-accent)'}}></div> AI ENGINE ACTIVE
            </div>
          </div>
          <button className="mobile-citations-toggle" onClick={() => setIsCitationRailVisible(true)}><Library size={24} /></button>
        </header>

        {activeTab === 'research' ? (
          <>
            <div className="chat-area">
              {messages.length === 0 && !isLoading && (
                <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.3, textAlign: 'center', padding: '1rem'}}>
                    <Scale size={80} strokeWidth={1} style={{marginBottom: '1rem'}} />
                    <p style={{fontFamily: 'var(--font-serif)', fontSize: '1.25rem'}}>High-Fidelity AI Jurisprudence Engine</p>
                </div>
              )}
              {messages.map((m) => (
                <div key={m.id} className={`msg-wrap ${m.role}`}>
                  <div className={`avatar ${m.role}`}>
                    {m.role === 'model' ? <Scale size={18} /> : 'LP'}
                  </div>
                  <div className="bubble">
                    <div style={{whiteSpace: 'pre-wrap', paddingBottom: m.role === 'model' ? '1rem' : '0' }}>
                      {m.text.split(/(\*\*.*?\*\*)/).map((p, j) => p.startsWith('**') ? <strong key={j} style={{color: 'var(--brand-gold)'}}>{p.slice(2,-2)}</strong> : p)}
                    </div>
                    {m.fileName && (
                      <div className="file-status-pill">
                        {m.fileURL?.includes('blob:http') && m.fileName.match(/\.(jpeg|jpg|png|gif)$/i) ? <FileImage size={14} /> : <FileText size={14} />}
                        <span style={{fontWeight: 600}}>{m.fileName}</span>
                        <span className={`status-${m.fileStatus?.split(' ')[0]}`}>{m.fileStatus}</span>
                      </div>
                    )}
                    {m.role === 'model' && m.text && (
                        <button className="tts-button" onClick={() => handleTextToSpeech(m)} title="Read Aloud">
                            <AudioWaveform size={16} className={playingAudioId === m.id ? 'playing' : ''} />
                        </button>
                    )}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="msg-wrap model">
                  <div className="avatar model"><Scale size={18} /></div>
                  <div className="bubble" style={{display: 'flex', alignItems: 'center', gap: '1rem'}}>
                    <Loader2 size={16} className="animate-spin" /> {loadingMessage}
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            
            {!isConfigured && (
              <div className="config-error-bar">
                <div className="config-error-content">
                  <AlertTriangle size={32} />
                  <div>
                    <strong>Configuration Error: API Key Not Found</strong>
                    <br />
                    Please check your <strong>GEMINI_API_KEY</strong> in Netlify site settings under <strong>Environment variables</strong> and <strong>Snippet Injection</strong>, then redeploy.
                  </div>
                </div>
              </div>
            )}
            <div className="input-bar">
              <div className="input-box-wrapper">
                {selectedFile && (
                  <div style={{background: '#F7FAFC', border: '1px solid #E2E8F0', padding: '0.5rem 1rem', borderRadius: '0.75rem', marginBottom: '0.75rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
                    <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                      {selectedFile.type.startsWith('image/') ? <FileImage size={16} color="var(--brand-navy)" /> : <FileText size={16} color="var(--brand-navy)" />}
                      <span style={{fontWeight: 600}}>{selectedFile.name}</span> 
                      <span style={{color: '#718096', fontStyle: 'italic'}}>(Analysis Pending)</span>
                    </div>
                    <X size={16} style={{cursor: 'pointer'}} onClick={() => setSelectedFile(null)} />
                  </div>
                )}
                <form onSubmit={handleSubmit}>
                  <input type="file" ref={fileInputRef} onChange={handleFileChange} style={{display: 'none'}} accept="image/*,application/pdf,text/*,.docx,.doc" />
                  <textarea 
                    ref={textareaRef}
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    onKeyDown={e => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e); } }}
                    className="input-textarea"
                    placeholder={!isConfigured ? "Application is not configured." : (isListening ? "Listening..." : "Analyze a case, statute, or upload a document/image...")}
                    rows={1}
                    disabled={!isConfigured}
                  />
                  <div className="input-actions">
                    <button type="button" className="action-btn" title="Attach Document/Image" onClick={() => fileInputRef.current?.click()} disabled={!isConfigured}>
                      <Paperclip size={20} />
                    </button>
                    <button type="button" className={`action-btn ${isListening ? 'active-mic' : ''}`} title="Voice Command" onClick={toggleListening} disabled={!isConfigured}>
                      {isListening ? <Mic size={20} /> : <MicOff size={20} />}
                    </button>
                    <button type="submit" className="send-btn" disabled={isLoading || (!userInput.trim() && !selectedFile) || !isConfigured}>
                      <Send size={18} />
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </>
        ) : activeTab === 'documents' ? (
          <div className="vault-container">
            <div className="vault-actions">
              <div style={{position: 'relative', flex: 1}}>
                <Search size={18} style={{position: 'absolute', left: '0.85rem', top: '0.85rem', color: '#A0AEC0'}} />
                <input type="text" className="search-input" placeholder="Search vaulted files..." value={docSearchTerm} onChange={e => setDocSearchTerm(e.target.value)} />
              </div>
              <button className="new-chat-btn" style={{margin: 0, padding: '0 1.5rem'}} onClick={() => docUploadInputRef.current?.click()}>
                <Download size={16} /> Batch Upload
              </button>
              <input type="file" multiple ref={docUploadInputRef} style={{display: 'none'}} onChange={handleMultiFileUpload} />
            </div>

            {isUploadingDocs && (
              <div className="upload-indicator">
                <div style={{display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 600}}>
                  <span>SYNCHRONIZING REPOSITORY...</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{width: `${uploadProgress}%`}}></div>
                </div>
              </div>
            )}

            <div className="doc-list-grid">
              {filteredDocs.map(d => {
                const incompleteTasks = d.tasks?.filter(t => !t.isComplete).length || 0;
                return (
                  <div key={d.id} className="doc-item">
                    <div style={{display: 'flex', alignItems: 'center', gap: '1rem', flex: 1}}>
                        <div style={{padding: '0.5rem', background: '#F7FAFC', borderRadius: '4px', cursor: 'pointer'}} onClick={() => setViewingDoc(d)}>
                            <FileText size={24} color="var(--brand-navy)" />
                        </div>
                        <div style={{flex: 1}}>
                            <div style={{fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer'}} onClick={() => setViewingDoc(d)}>{d.name}</div>
                            <div style={{fontSize: '0.7rem', color: '#718096'}}>{d.date} • {d.type.split('/')[1]?.toUpperCase() || 'DOCUMENT'}</div>
                        </div>
                    </div>
                    <div style={{display: 'flex', gap: '0.5rem', alignItems: 'center'}}>
                       <button className="action-btn" title={d.file ? "Get AI Summary" : "Re-upload to summarize"} onClick={() => handleSummarizeDocument(d)} disabled={!d.file || !isConfigured} >
                        <BookOpenText size={18} />
                      </button>
                      <button className="action-btn" title={d.file ? "Analyze with Gemini" : "Re-upload to analyze"} onClick={() => setAnalyzingDoc(d)} disabled={!d.file || !isConfigured}>
                        <Sparkles size={18} />
                      </button>
                      <button className="action-btn" title="Manage Tasks" onClick={() => setManagingTasksForDoc(d)} style={{position: 'relative'}}>
                        <ListTodo size={18} />
                        {incompleteTasks > 0 && <span className="task-badge">{incompleteTasks}</span>}
                      </button>
                      <button className="action-btn" style={{color: '#FC8181'}} title="Delete" onClick={() => setManagedDocs(prev => prev.filter(x => x.id !== d.id))}><Trash2 size={18} /></button>
                    </div>
                  </div>
                );
              })}
              {filteredDocs.length === 0 && <div style={{textAlign: 'center', padding: '4rem', opacity: 0.2}}>No records found in current index.</div>}
            </div>
          </div>
        ) : ( // History Tab
          <div className="vault-container">
            {sessionHistory.length === 0 ? (
              <div style={{textAlign: 'center', padding: '6rem', opacity: 0.2}}>
                <History size={64} style={{marginBottom: '1rem'}} />
                <p>History archive is empty.</p>
              </div>
            ) : (
              sessionHistory.map(s => (
                <div key={s.id} className="history-item" onClick={() => loadSession(s)}>
                  <div style={{display: 'flex', alignItems: 'center', gap: '1rem'}}>
                    <Clock size={20} color="var(--brand-gold)" />
                    <div>
                      <div style={{fontWeight: 700, fontSize: '1rem', color: 'var(--brand-navy)', marginBottom: '0.25rem'}}>{s.title}</div>
                      <div style={{fontSize: '0.75rem', color: '#718096'}}>{s.date} • {s.messages.length} exchanges</div>
                    </div>
                  </div>
                  <button className="delete-btn" style={{border: 'none', background: 'transparent', cursor: 'pointer'}} onClick={(e) => deleteSession(s.id, e)}><Trash2 size={18} /></button>
                </div>
              ))
            )}
          </div>
        )}
      </main>

      {/* CITATIONS RAIL */}
      {activeTab === 'research' && (
        <>
            <aside className={`right-rail ${!isCitationRailVisible ? (window.innerWidth > 768 ? 'hidden' : '') : 'mobile-visible'}`}>
                <div className="rail-header">VERIFIED CITATIONS</div>
                <div className="citation-list">
                    {citations.length === 0 ? (
                    <div style={{textAlign: 'center', padding: '4rem 1rem', opacity: 0.2, fontSize: '0.85rem'}}>
                        Legal citations and evidentiary sources will appear here as they are generated.
                    </div>
                    ) : (
                        displayedCitations.map((c, i) => (
                        <div key={i} className="citation-card">
                            <div className="card-title">
                            {c.web ? <Globe size={14} color="#3182CE" /> : <ListFilter size={14} color="#A0AEC0" />}
                            {c.web?.title || 'Grounding Reference'}
                            </div>
                            {c.web?.uri && <div className="citation-meta">{c.web.uri}</div>}
                            <div style={{fontSize: '0.75rem', color: '#4A5568', lineHeight: 1.4}}>
                            {c.text ? c.text.substring(0, 120) + '...' : "Authoritative legal background and interpretative context supporting the current analysis."}
                            </div>
                            {c.web && (
                            <div className="citation-actions">
                                <button className="cite-action-btn" onClick={() => copyToClipboard(c.web?.uri || '')}>
                                <Copy size={12} /> Copy Link
                                </button>
                                <a href={c.web.uri} target="_blank" rel="noreferrer" className="cite-action-btn">
                                <ExternalLink size={12} /> External Link
                                </a>
                            </div>
                            )}
                        </div>
                        ))
                    )}
                </div>
            </aside>
            <button 
                className={`rail-toggle-btn ${!isCitationRailVisible ? 'hidden' : ''}`}
                onClick={() => setIsCitationRailVisible(!isCitationRailVisible)}
                title={isCitationRailVisible ? "Hide Citations" : "Show Citations"}
            >
                {isCitationRailVisible ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            </button>
        </>
      )}

      {/* MODALS */}
      {viewingDoc && <div className="modal-overlay" onClick={() => setViewingDoc(null)}><div className="modal-content doc-viewer" onClick={e => e.stopPropagation()}><div className="modal-header"><h3>{viewingDoc.name}</h3><div className="viewer-controls"><button onClick={() => alert("Search is a WIP feature.")}><Search size={16} /> Search</button><button onClick={() => alert("Zoom is a WIP feature.")}><ZoomIn size={16} /></button><button onClick={() => alert("Zoom is a WIP feature.")}><ZoomOut size={16} /></button><button onClick={handlePrintDoc}><Printer size={16} /> Print</button></div><button className="close-modal" onClick={() => setViewingDoc(null)}><X size={20} /></button></div><iframe ref={docViewerFrameRef} src={viewingDoc.url} title={viewingDoc.name} /></div></div>}
      {managingTasksForDoc && <div className="modal-overlay" onClick={() => setManagingTasksForDoc(null)}><div className="modal-content" onClick={e => e.stopPropagation()}><div className="modal-header"><h3>Tasks for: {managingTasksForDoc.name}</h3><button className="close-modal" onClick={() => setManagingTasksForDoc(null)}><X size={20} /></button></div><div className="task-manager"><div className="task-list">{managingTasksForDoc.tasks.length === 0 && <p style={{textAlign: 'center', color: '#718096', fontSize: '0.9rem'}}>No tasks for this document.</p>}{managingTasksForDoc.tasks.map(task => (<div key={task.id} className={`task-item ${task.isComplete ? 'complete' : ''}`}><input type="checkbox" checked={task.isComplete} onChange={() => toggleTask(managingTasksForDoc.id, task.id)} /><div className="task-details"><p>{task.text}</p>{task.deadline && <small>Due: {task.deadline}</small>}</div><button className="delete-task" onClick={() => deleteTask(managingTasksForDoc.id, task.id)}><Trash2 size={16} /></button></div>))}</div><div className="add-task-form"><input type="text" placeholder="New task..." value={newTaskText} onChange={e => setNewTaskText(e.target.value)} /><input type="date" value={newTaskDeadline} onChange={e => setNewTaskDeadline(e.target.value)} /><button onClick={() => handleAddTask(managingTasksForDoc.id)}>Add Task</button></div></div></div></div>}
      {analyzingDoc && <div className="modal-overlay" onClick={() => setAnalyzingDoc(null)}><div className="modal-content" onClick={e => e.stopPropagation()} style={{maxWidth: '600px'}}><div className="modal-header"><h3>Analyze: {analyzingDoc.name}</h3><button className="close-modal" onClick={() => { setAnalyzingDoc(null); setAnalysisResult(''); setAnalysisPrompt(''); }}><X size={20} /></button></div><div className="analysis-manager"><p style={{fontSize: '0.9rem', color: '#4A5568', marginTop: 0}}>What would you like to know about this document?</p><textarea value={analysisPrompt} onChange={e => setAnalysisPrompt(e.target.value)} placeholder="e.g., Summarize the key arguments in this document." rows={3}></textarea><button onClick={handleAnalyzeDocument} disabled={isAnalyzing || !analysisPrompt || !isConfigured}>{isAnalyzing ? <><Loader2 size={16} className="animate-spin" /> Analyzing...</> : <><Sparkles size={16}/> Analyze</>}</button>{analysisResult && <div className="analysis-result"><h4>Analysis Result:</h4><div className="bubble model" style={{maxWidth: '100%', whiteSpace: 'pre-wrap'}}>{analysisResult}</div></div>}</div></div></div>}
      {summarizingDoc && (
        <div className="modal-overlay" onClick={() => setSummarizingDoc(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{maxWidth: '700px'}}>
            <div className="modal-header">
              <h3>AI Summary: {summarizingDoc.name}</h3>
              <button className="close-modal" onClick={() => setSummarizingDoc(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="summary-content" style={{ padding: '1.5rem', maxHeight: '70vh', overflowY: 'auto' }}>
              {isSummarizing ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '200px' }}>
                  <Loader2 size={32} className="animate-spin" />
                  <p style={{ marginTop: '1rem', color: '#718096' }}>Generating summary...</p>
                </div>
              ) : (
                <div className="bubble model" style={{ maxWidth: '100%', whiteSpace: 'pre-wrap' }}>
                  {summaryResult}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<JurisApp />);
