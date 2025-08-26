import { Pagination as BootstrapPagination } from "react-bootstrap";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  currentOffset: number;
  onPageChange: (page: number) => void;
  showInfo?: boolean;
}

export default function Pagination({
  currentPage,
  totalPages,
  totalItems,
  itemsPerPage,
  currentOffset,
  onPageChange,
  showInfo = true,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const startItem = currentOffset + 1;
  const endItem = Math.min(currentOffset + itemsPerPage, totalItems);

  return (
    <div className="d-flex justify-content-between align-items-center">
      {showInfo && (
        <div className="text-muted">
          Showing {startItem} to {endItem} of {totalItems} items
        </div>
      )}
      <BootstrapPagination>
        <BootstrapPagination.First
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1}
        />
        <BootstrapPagination.Prev
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
        />

        {(() => {
          // Generate all page numbers to show, avoiding duplicates
          const pagesToShow = new Set<number>();

          // Always show pages around current page (up to 5 pages total)
          const startPage = Math.max(1, currentPage - 2);
          const endPage = Math.min(totalPages, currentPage + 2);

          for (let i = startPage; i <= endPage; i++) {
            pagesToShow.add(i);
          }

          // If we're not showing page 1 and there's a gap, show page 1
          const showFirstPage = !pagesToShow.has(1) && currentPage > 3;
          const showLastPage =
            !pagesToShow.has(totalPages) && currentPage < totalPages - 2;

          const pages = Array.from(pagesToShow).sort((a, b) => a - b);

          return (
            <>
              {/* Show first page with ellipsis if needed */}
              {showFirstPage && (
                <>
                  <BootstrapPagination.Item onClick={() => onPageChange(1)}>
                    1
                  </BootstrapPagination.Item>
                  {currentPage > 4 && <BootstrapPagination.Ellipsis />}
                </>
              )}

              {/* Show main page range */}
              {pages.map((page) => (
                <BootstrapPagination.Item
                  key={page}
                  active={page === currentPage}
                  onClick={() => onPageChange(page)}
                >
                  {page}
                </BootstrapPagination.Item>
              ))}

              {/* Show last page with ellipsis if needed */}
              {showLastPage && (
                <>
                  {currentPage < totalPages - 3 && (
                    <BootstrapPagination.Ellipsis />
                  )}
                  <BootstrapPagination.Item
                    onClick={() => onPageChange(totalPages)}
                  >
                    {totalPages}
                  </BootstrapPagination.Item>
                </>
              )}
            </>
          );
        })()}

        <BootstrapPagination.Next
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
        />
        <BootstrapPagination.Last
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages}
        />
      </BootstrapPagination>
    </div>
  );
}
