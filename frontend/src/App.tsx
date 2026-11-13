import { Routes, Route } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import QualificationPage from "./pages/QualificationPage";
import TraitementsPage from "./pages/TraitementsPage";
import HistoriquePage from "./pages/HistoriquePage";
import BatimentsPage from "./pages/BatimentsPage";
import ParametresPage from "./pages/ParametresPage";

export default function App() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<QualificationPage />} />
          <Route path="/traitements" element={<TraitementsPage />} />
          <Route path="/historique" element={<HistoriquePage />} />
          <Route path="/batiments" element={<BatimentsPage />} />
          <Route path="/parametres" element={<ParametresPage />} />
        </Routes>
      </main>
    </div>
  );
}
