import React from 'react';

function TestLogin() {
  const clearAll = () => {
    localStorage.clear();
    window.location.href = '/';
  };

  const checkStorage = () => {
    const user = localStorage.getItem('chatUser');
    alert(user ? `User found: ${user}` : 'No user found');
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="bg-gray-800 p-8 rounded-lg shadow-xl w-96">
        <h2 className="text-2xl text-white mb-4">Debug Menu</h2>
        
        <button
          onClick={checkStorage}
          className="w-full mb-2 bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
        >
          Check LocalStorage
        </button>
        
        <button
          onClick={clearAll}
          className="w-full bg-red-600 text-white py-2 rounded hover:bg-red-700"
        >
          Clear All & Reload
        </button>
        
        <p className="text-gray-400 text-sm mt-4 text-center">
          localStorage status: {localStorage.getItem('chatUser') ? '✅ Has user' : '❌ Empty'}
        </p>
      </div>
    </div>
  );
}

export default TestLogin;